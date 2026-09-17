import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { runFile } from '../src/run-file.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

const SHELL_IMPORT =
  /(?:import\s*\{([^}]+)\}\s*from\s*['"]node:child_process['"]|\{\s*([^}]+)\s*\}\s*=\s*(?:await\s*)?import\(\s*['"]node:child_process['"]\s*\))/;
const SHELL_CALL = /\bexecSync\s*\(/;
const SHELL_TRUE = /\bshell\s*:\s*true\b/;

function importedShellApi(src) {
  const match = src.match(SHELL_IMPORT);
  if (!match) {
    return false;
  }
  const names = `${match[1] || ''} ${match[2] || ''}`
    .split(',')
    .map((part) => part.trim().split(/\s+as\s+/)[0].trim());
  return names.includes('exec') || names.includes('execSync');
}

function walkPublished(dir, acc = []) {
  if (!fs.existsSync(dir)) {
    return acc;
  }
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      walkPublished(full, acc);
    } else if (/\.(js|mjs|cjs|py|md|mdc|json)$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('no shell spawn in published JS', () => {
  it('does not import or call child_process.exec / execSync (Socket shellAccess)', () => {
    const dirs = (pkg.files || []).filter((entry) => {
      const full = path.join(repoRoot, entry);
      return fs.existsSync(full) && fs.statSync(full).isDirectory();
    });
    const files = dirs.flatMap((dir) => walkPublished(path.join(repoRoot, dir)).filter((f) => f.endsWith('.js')));
    assert.ok(files.length > 0, 'expected published JS');

    const hits = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      if (importedShellApi(src) || SHELL_CALL.test(src) || SHELL_TRUE.test(src)) {
        hits.push(path.relative(repoRoot, file));
      }
    }
    assert.deepEqual(hits, [], 'use execFileSync/spawnSync argv (no /bin/sh)');
  });

  it('published artifacts do not contain eval-call or Function-constructor syntax', () => {
    const listed = (pkg.files || []).map((entry) => path.join(repoRoot, entry));
    const files = [];
    for (const entry of listed) {
      if (!fs.existsSync(entry)) {
        continue;
      }
      if (fs.statSync(entry).isDirectory()) {
        walkPublished(entry, files);
      } else if (/\.(js|mjs|cjs|py|md|mdc|json)$/.test(entry)) {
        files.push(entry);
      }
    }
    const DYNAMIC = /\beval\s*\(|\bnew\s+Function\s*\(/;
    const hits = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      if (DYNAMIC.test(src)) {
        hits.push(path.relative(repoRoot, file));
      }
    }
    assert.deepEqual(hits, [], 'Socket usesEval matches eval( / new Function( even in strings');
  });

  it('runFile invokes the binary via argv, not a shell string', () => {
    const out = runFile(process.execPath, ['-p', '"ok"'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    assert.match(String(out).trim(), /^ok$/);
  });
});
