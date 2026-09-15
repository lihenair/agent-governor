/**
 * `governor status` — team policy drift detection.
 *
 * Teams commit `governor.config.json`. A member (or a sneaky agent) can
 * loosen protection locally with `unprotect` / `override` / removed patterns.
 * Status compares the working config against the committed one and reports
 * exactly what got weaker, so drift is visible instead of silent.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, CONFIG } from './config.js';

function gitShow(repoRoot, relPath) {
  try {
    return execSync(`git show HEAD:${JSON.stringify(relPath)}`, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function gitIsRepo(repoRoot) {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

/** Diff two resolved configs; report local weakening vs committed baseline. */
export function diffConfigs(committed, working) {
  const weakenings = [];
  const committedFiles = new Set(committed.protectedFiles || []);
  const workingFiles = new Set(working.protectedFiles || []);

  for (const file of committedFiles) {
    if (!workingFiles.has(file)) {
      weakenings.push({ kind: 'unprotected-file', detail: file });
    }
  }

  const committedPatterns = (committed.forbiddenBashPatterns || []).map((p) => p.source || String(p));
  const workingPatterns = new Set((working.forbiddenBashPatterns || []).map((p) => p.source || String(p)));
  for (const source of committedPatterns) {
    if (!workingPatterns.has(source)) {
      weakenings.push({ kind: 'removed-bash-pattern', detail: source });
    }
  }

  const astWeakened = [];
  for (const [key, value] of Object.entries(committed.astRules || {})) {
    if (value === true && working.astRules?.[key] !== true) {
      astWeakened.push(key);
    }
  }
  if (astWeakened.length > 0) {
    weakenings.push({ kind: 'disabled-ast-rules', detail: astWeakened.join(', ') });
  }

  if ((committed.injectionMode || 'scan') === 'scan' && (working.injectionMode || 'scan') === 'off') {
    weakenings.push({ kind: 'injection-scan-off', detail: 'injectionMode was scan, now off' });
  }

  return weakenings;
}

/**
 * Build the status report.
 *
 * @param {string} projectRoot
 */
export async function buildStatus(projectRoot = process.cwd()) {
  const checks = [];

  const isRepo = gitIsRepo(projectRoot);
  const configRel = 'governor.config.json';
  const configPath = path.join(projectRoot, configRel);
  const working = await loadConfig(projectRoot);

  checks.push({
    id: 'config-exists',
    ok: fs.existsSync(configPath),
    detail: fs.existsSync(configPath)
      ? 'governor.config.json present'
      : 'governor.config.json missing (defaults in effect)',
    fix: 'Run: npx agent-governor init',
  });

  let committed = null;
  if (isRepo && fs.existsSync(configPath)) {
    const raw = gitShow(projectRoot, configRel);
    if (raw !== null) {
      try {
        committed = JSON.parse(raw);
        checks.push({
          id: 'config-committed',
          ok: true,
          detail: 'governor.config.json is committed (team baseline available)',
        });
      } catch (err) {
        checks.push({
          id: 'config-committed',
          ok: false,
          detail: `committed governor.config.json does not parse: ${err.message}`,
          fix: 'Commit a valid JSON config.',
        });
      }
    } else {
      checks.push({
        id: 'config-committed',
        ok: true,
        warn: true,
        detail: 'governor.config.json is not committed — teammates get defaults only',
        fix: `git add ${configRel} && git commit`,
      });
    }
  }

  let weakenings = [];
  if (committed) {
    const committedResolved = (() => {
      try {
        // Cheap resolution without touching disk again: merge on top of defaults.
        return working; // placeholder, replaced below
      } catch {
        return null;
      }
    })();

    // Resolve the committed config independently.
    const { mergeConfig } = await import('./config.js');
    const getPreset = (await import('./presets.js')).getPreset;
    let base = CONFIG;
    if (committed.preset) {
      try {
        base = mergeConfig(CONFIG, getPreset(committed.preset));
      } catch {
        base = CONFIG;
      }
    }
    const resolvedCommitted = mergeConfig(base, committed);
    weakenings = diffConfigs(resolvedCommitted, working);

    if (weakenings.length === 0) {
      checks.push({
        id: 'policy-drift',
        ok: true,
        detail: 'local config matches the committed baseline (no weakening)',
      });
    } else {
      checks.push({
        id: 'policy-drift',
        ok: false,
        detail: `${weakenings.length} local weakening(s) vs committed baseline`,
        fix: 'Restore protection or commit an intentional change: git diff governor.config.json',
      });
    }
  }

  return { projectRoot, isRepo, checks, weakenings, working };
}

/**
 * Format status for terminal output.
 */
export function formatStatus({ checks, weakenings, working }) {
  const lines = ['🛡️ Agent Governor Status', ''];
  for (const check of checks) {
    const icon = check.ok ? (check.warn ? '⚠️' : '✔') : '✘';
    lines.push(` ${icon} ${check.id.padEnd(18)} ${check.detail}`);
    if (check.fix && (check.warn || !check.ok)) {
      lines.push(`   ↳ ${check.fix}`);
    }
  }

  if (weakenings && weakenings.length > 0) {
    lines.push('', '  local policy is WEAKER than committed:');
    for (const w of weakenings) {
      lines.push(`   - [${w.kind}] ${w.detail}`);
    }
  }

  lines.push(
    '',
    `  active: ${working.protectedFiles.length} protected files, ${
      (working.forbiddenBashPatterns || []).length
    } bash patterns, injectionMode=${working.injectionMode || 'scan'}`
  );
  return `${lines.join('\n')}\n`;
}
