import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SELF_HASH_REL = '.agent-governor/self-hash.json';

const VOLATILE_NAMES = new Set(['self-hash.json', 'audit.log', 'audit.log.1']);

const ROOT_FILES = [
  '.claude/settings.json',
  'governor.config.json',
  'governor.config.js',
  'governor.config.cjs',
  'governor.config.mjs',
];

function toPosix(rel) {
  return rel.split(path.sep).join('/');
}

function listProtectedFiles(repoRoot) {
  const files = [];

  for (const rel of ROOT_FILES) {
    const abs = path.join(repoRoot, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      files.push(toPosix(rel));
    }
  }

  const govDir = path.join(repoRoot, '.agent-governor');
  if (fs.existsSync(govDir) && fs.statSync(govDir).isDirectory()) {
    walkDir(govDir, repoRoot, files);
  }

  return [...new Set(files)].sort();
}

function walkDir(dir, repoRoot, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (VOLATILE_NAMES.has(entry.name)) {
      continue;
    }
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(abs, repoRoot, files);
    } else if (entry.isFile()) {
      files.push(toPosix(path.relative(repoRoot, abs)));
    }
  }
}

function sha256File(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

/**
 * @param {string} repoRoot
 * @returns {Record<string, string>}
 */
export function computeHashes(repoRoot) {
  const hashes = {};
  for (const rel of listProtectedFiles(repoRoot)) {
    hashes[rel] = sha256File(path.join(repoRoot, rel));
  }
  return hashes;
}

/**
 * @param {string} repoRoot
 * @param {Record<string, string>} stored
 * @returns {{ok: boolean, mismatches: {path: string, expected: string|null, actual: string|null}[]}}
 */
export function verifyHashes(repoRoot, stored) {
  const current = computeHashes(repoRoot);
  const keys = new Set([...Object.keys(stored || {}), ...Object.keys(current)]);
  const mismatches = [];

  for (const filePath of keys) {
    const expected = stored?.[filePath] ?? null;
    const actual = current[filePath] ?? null;
    if (expected !== actual) {
      mismatches.push({ path: filePath, expected, actual });
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

function readStored(repoRoot) {
  const abs = path.join(repoRoot, SELF_HASH_REL);
  if (!fs.existsSync(abs)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return parsed.hashes && typeof parsed.hashes === 'object' ? parsed.hashes : parsed;
  } catch {
    return null;
  }
}

function writeStored(repoRoot, hashes) {
  const abs = path.join(repoRoot, SELF_HASH_REL);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify({ version: 1, hashes }, null, 2)}\n`);
}

function formatWarning(mismatches) {
  const paths = mismatches.map((item) => item.path).join(', ');
  return `[Agent Governor] self-hash mismatch: ${paths}`;
}

/**
 * First run writes `.agent-governor/self-hash.json`. Later runs compare.
 *
 * @param {string} repoRoot
 * @param {{failureMode?: 'open'|'closed'}} [options]
 */
export function ensureSelfProtect(repoRoot, options = {}) {
  const failureMode = options.failureMode === 'closed' ? 'closed' : 'open';
  const stored = readStored(repoRoot);
  const hashes = computeHashes(repoRoot);

  if (!stored) {
    if (Object.keys(hashes).length === 0) {
      return { ok: true, initialized: false, mismatches: [], exitCode: 0 };
    }
    writeStored(repoRoot, hashes);
    return { ok: true, initialized: true, mismatches: [], exitCode: 0 };
  }

  const result = verifyHashes(repoRoot, stored);
  if (result.ok) {
    return { ok: true, initialized: false, mismatches: [], exitCode: 0 };
  }

  return {
    ok: false,
    initialized: false,
    mismatches: result.mismatches,
    warning: formatWarning(result.mismatches),
    exitCode: failureMode === 'closed' ? 2 : 0,
  };
}

/**
 * Combine integrity result with a later policy decision.
 *
 * @param {{warning?: string, exitCode?: number}} protect
 * @param {{exitCode?: number, stderr?: string, [key: string]: unknown}} decision
 */
export function mergeProtectResult(protect, decision) {
  const stderrParts = [protect?.warning, decision?.stderr].filter(Boolean);
  const stderr = stderrParts.length > 0 ? stderrParts.join('\n') : undefined;

  if (protect?.exitCode === 2) {
    return { ...decision, exitCode: 2, stderr };
  }

  return stderr ? { ...decision, stderr } : decision;
}
