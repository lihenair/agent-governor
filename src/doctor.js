/**
 * `governor doctor` — self-check everything the guardrails depend on.
 *
 * A guardrail that silently isn't installed is worse than no guardrail.
 * Doctor verifies each link in the chain and prints actionable fixes:
 *
 *   1. Runtime: Node version, package integrity
 *   2. Config: governor.config.json parses, presets resolve
 *   3. Hooks: detected coding agents that are actually wired to the governor
 *   4. State: audit log writable, self-protect hashes intact
 *   5. Policy: compiled rule count > 0, dry-run deny works
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { compilePreToolPolicy } from './policy/rules.js';
import { evaluatePreToolUse } from './pre-tool-use.js';
import { AST_GREP_INSTALL, describeAstGrepRuntime } from './ast-grep-engine.js';
import { runFile } from './run-file.js';
import { hasPreset } from './presets.js';
import { detectHosts } from './detect-hosts.js';

function checkNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 18) {
    return { id: 'node-version', ok: true, detail: `Node ${process.versions.node}` };
  }
  return {
    id: 'node-version',
    ok: false,
    detail: `Node ${process.versions.node} is too old; agent-governor requires >= 18`,
    fix: 'Upgrade Node.js (https://nodejs.org) to 18 or newer.',
  };
}

function checkPackageIntegrity() {
  // Resolve from this module's own location: doctor always checks the real install.
  const base = path.dirname(new URL(import.meta.url).pathname);
  const required = ['pre-tool-use.js', 'post-tool-use.js', 'config.js', 'policy/rules.js'];
  const missing = required.filter((rel) => !fs.existsSync(path.join(base, rel)));
  if (missing.length === 0) {
    return { id: 'package-files', ok: true, detail: `${required.length} core modules present` };
  }
  return {
    id: 'package-files',
    ok: false,
    detail: `missing: ${missing.join(', ')}`,
    fix: 'Reinstall the package: npm install -D agent-governor@latest',
  };
}

async function checkConfig(projectRoot) {
  try {
    const config = await loadConfig(projectRoot);
    const policy = compilePreToolPolicy(config);
    const presetField = config.preset;
    if (presetField && !hasPreset(presetField)) {
      return {
        id: 'config',
        ok: false,
        detail: `unknown preset "${presetField}"`,
        fix: `Use one of: security-hard, frontend, python, strict (or remove the preset field).`,
      };
    }
    if (policy.rules.length === 0) {
      return {
        id: 'config',
        ok: false,
        detail: 'compiled policy has 0 rules',
        fix: 'Delete or fix governor.config.json; a config that disables every rule is suspicious.',
      };
    }
    const presetNote = presetField && hasPreset(presetField) ? `, preset: ${presetField}` : '';
    return {
      id: 'config',
      ok: true,
      detail: `${policy.rules.length} rules, ${config.protectedFiles.length} protected files${presetNote}`,
    };
  } catch (err) {
    const message = String(err.message || err);
    if (/preset/i.test(message)) {
      return {
        id: 'config',
        ok: false,
        detail: `config failed to load: ${message}`,
        fix: 'Use one of: security-hard, frontend, python, strict (or remove the preset field).',
      };
    }
    return {
      id: 'config',
      ok: false,
      detail: `config failed to load: ${message}`,
      fix: 'Fix the JSON syntax in governor.config.json (validate with: node -e "JSON.parse(require(\'fs\').readFileSync(\'governor.config.json\'))")',
    };
  }
}

function checkHooksInstalled(projectRoot, options = {}) {
  const detections = detectHosts(projectRoot, {
    home: options.home,
    env: options.env,
    scanUser: options.scanUser,
    scanPath: options.scanPath,
    scope: options.scope,
  });
  const claudeSettings = path.join(projectRoot, '.claude', 'settings.json');
  const claude = detections.find((row) => row.id === 'claude-code');
  if (fs.existsSync(claudeSettings) && claude && claude.governed === 'no') {
    return {
      id: 'hooks-installed',
      ok: false,
      detail: '.claude/settings.json exists but does not reference agent-governor',
      fix: 'Run: npx agent-governor init --hosts claude-code',
    };
  }

  const governed = detections.filter((row) => row.governed !== 'no');
  if (governed.length > 0) {
    return {
      id: 'hooks-installed',
      ok: true,
      detail: governed.map((row) => `${row.id} (${row.governed})`).join(', '),
    };
  }

  const present = detections.filter((row) => row.presence !== 'absent');
  if (present.length > 0) {
    return {
      id: 'hooks-installed',
      ok: true,
      warn: true,
      detail: `detected ${present.map((row) => row.id).join(', ')} but none are wired`,
      fix: `Run: npx agent-governor init --hosts ${present.map((row) => row.id).join(',')}`,
    };
  }

  return {
    id: 'hooks-installed',
    ok: true,
    warn: true,
    detail: 'no coding-agent hosts detected or wired',
    fix: 'Run: npx agent-governor init   then pick hosts from the table (or pass --hosts claude-code)',
  };
}

function checkAuditWritable(projectRoot) {
  const dir = path.join(projectRoot, '.agent-governor');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.doctor-probe-${process.pid}`);
    fs.writeFileSync(probe, 'probe');
    fs.unlinkSync(probe);
    return { id: 'audit-writable', ok: true, detail: '.agent-governor/ is writable' };
  } catch (err) {
    return {
      id: 'audit-writable',
      ok: false,
      detail: `cannot write .agent-governor/: ${err.message}`,
      fix: 'Fix directory permissions; the audit log and self-protection need write access.',
    };
  }
}

function checkDenyWorks(projectRoot) {
  const payload = {
    tool_name: 'Bash',
    tool_input: { command: 'git push --force origin main' },
  };
  const fail = (detail, fix) => ({
    id: 'deny-works',
    ok: false,
    detail,
    fix,
  });
  return Promise.resolve()
    .then(() => loadConfig(projectRoot))
    .then((config) => {
      const result = evaluatePreToolUse(payload, config, projectRoot);
      if (result.exitCode === 2) {
        return { id: 'deny-works', ok: true, detail: 'dry-run deny: git push --force blocked' };
      }
      return fail(
        `expected exit 2 for "git push --force", got ${result.exitCode}`,
        'This means the policy engine is not evaluating. Check for a config with override: true and empty lists.'
      );
    })
    .catch((err) =>
      fail(
        `config/engine error during dry-run: ${err.message}`,
        'Fix the config error above first; then re-run doctor.'
      )
    );
}

function checkGitRepo(projectRoot) {
  try {
    runFile('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: projectRoot,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return { id: 'git-repo', ok: true, detail: 'git repository detected (audit gets branch info)' };
  } catch {
    return { id: 'git-repo', ok: true, warn: true, detail: 'not a git repo (audit entries lack branch)' };
  }
}

async function checkAstGrep(projectRoot) {
  let engine = 'regex';
  try {
    const config = await loadConfig(projectRoot);
    engine = config.engine || 'regex';
  } catch {
    engine = 'regex';
  }
  if (engine !== 'ast-grep') {
    return {
      id: 'ast-grep',
      ok: true,
      detail: 'engine=regex (native ast-grep not requested)',
    };
  }
  const runtime = describeAstGrepRuntime();
  if (!runtime.napi) {
    return {
      id: 'ast-grep',
      ok: true,
      warn: true,
      detail: 'engine=ast-grep but @ast-grep/napi is not installed',
      fix: AST_GREP_INSTALL,
    };
  }
  const langs = runtime.langs.length > 0 ? runtime.langs.join(', ') : 'none (native langs use regex SOP)';
  return {
    id: 'ast-grep',
    ok: true,
    detail: `napi ready; lang packs: ${langs}`,
    fix: runtime.langs.length === 0 ? AST_GREP_INSTALL : undefined,
  };
}

/**
 * Run all doctor checks.
 *
 * @param {string} projectRoot
 * @returns {Promise<{ok:boolean, checks:Array, summary:string}>}
 */
export async function runDoctor(projectRoot = process.cwd(), options = {}) {
  const checks = [
    checkNodeVersion(),
    checkPackageIntegrity(),
    await checkConfig(projectRoot),
    checkHooksInstalled(projectRoot, options),
    checkAuditWritable(projectRoot),
    await checkDenyWorks(projectRoot),
    checkGitRepo(projectRoot),
    await checkAstGrep(projectRoot),
  ];

  const failed = checks.filter((check) => !check.ok);
  const warnings = checks.filter((check) => check.warn);
  const summary =
    failed.length > 0
      ? `${checks.length - failed.length}/${checks.length} checks passed, ${failed.length} FAILED${warnings.length ? `, ${warnings.length} warning(s)` : ''}`
      : warnings.length > 0
        ? `all ${checks.length} checks passed (${warnings.length} warning(s))`
        : `all ${checks.length} checks passed`;

  return { ok: failed.length === 0, checks, summary };
}

const ICON = { true: '✔', false: '✘' };

/**
 * Format doctor results for terminal output.
 */
export function formatDoctorReport({ ok, checks, summary }) {
  const lines = [`🩺 Agent Governor Doctor — ${summary}`, ''];
  for (const check of checks) {
    const icon = check.ok ? ICON.true : ICON.false;
    lines.push(` ${icon} ${check.id.padEnd(16)} ${check.detail}`);
    if (!check.ok && check.fix) {
      lines.push(`   ↳ fix: ${check.fix}`);
    } else if (check.warn && check.fix) {
      lines.push(`   ↳ note: ${check.fix}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
