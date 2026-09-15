import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildStatus, diffConfigs, formatStatus } from '../src/status.js';
import { execSync } from 'node:child_process';
import { CONFIG } from '../src/config.js';

function tmpRepo(t, { commit = null, workdir = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-status-'));
  const run = (cmd) => {
    try {
      execSync(cmd, { cwd: dir, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };

  run('git init');
  run('git config user.email test@test');
  run('git config user.name test');
  if (commit) {
    fs.writeFileSync(path.join(dir, 'governor.config.json'), JSON.stringify(commit));
  } else {
    fs.writeFileSync(path.join(dir, 'governor.config.json'), JSON.stringify({}));
  }
  run('git add -A');
  run('git commit -m init');
  if (workdir) {
    fs.writeFileSync(path.join(dir, 'governor.config.json'), JSON.stringify(workdir));
  }
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('status: diffConfigs detects every weakening kind', () => {
  const committed = {
    ...CONFIG,
    astRules: { ...CONFIG.astRules, goForbidPanic: true, noDirectEval: true },
    injectionMode: 'scan',
  };
  const working = {
    ...committed,
    protectedFiles: committed.protectedFiles.filter((f) => f !== 'tsconfig.json'),
    forbiddenBashPatterns: committed.forbiddenBashPatterns.slice(0, 3),
    astRules: { ...committed.astRules, goForbidPanic: false },
    injectionMode: 'off',
  };
  const drift = diffConfigs(committed, working);
  const kinds = drift.map((d) => d.kind);
  assert.ok(kinds.includes('unprotected-file'));
  assert.ok(kinds.includes('removed-bash-pattern'));
  assert.ok(kinds.includes('disabled-ast-rules'));
  assert.ok(kinds.includes('injection-scan-off'));
});

test('status: identical configs produce no drift', () => {
  const drift = diffConfigs(CONFIG, CONFIG);
  assert.equal(drift.length, 0);
});

test('status: clean repo passes with committed baseline', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-status-ok-'));
  try {
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email t@t', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.name t', { cwd: dir, stdio: 'ignore' });
    fs.writeFileSync(path.join(dir, 'governor.config.json'), JSON.stringify({}));
    execSync('git add -A', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m i', { cwd: dir, stdio: 'ignore' });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    return buildStatus(dir).then((report) => {
      const drift = report.checks.find((c) => c.id === 'policy-drift');
      assert.ok(drift);
      assert.equal(drift.ok, true);
      assert.match(drift.detail, /no weakening/);
    });
  } catch (err) {
    t.skip(`git unavailable: ${err.message}`);
  }
});

test('status: locally weakened config is flagged with specifics', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-status-drift-'));
  try {
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email t@t', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.name t', { cwd: dir, stdio: 'ignore' });
    // Committed baseline protects tsconfig.json explicitly.
    fs.writeFileSync(
      path.join(dir, 'governor.config.json'),
      JSON.stringify({ protectedFiles: ['tsconfig.json'] })
    );
    execSync('git add -A', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m i', { cwd: dir, stdio: 'ignore' });
    // Working copy loosens it.
    fs.writeFileSync(
      path.join(dir, 'governor.config.json'),
      JSON.stringify({ protectedFiles: ['tsconfig.json'], unprotect: ['tsconfig.json'] })
    );
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    return buildStatus(dir).then((report) => {
      const drift = report.checks.find((c) => c.id === 'policy-drift');
      assert.ok(drift, 'policy-drift check should exist');
      assert.equal(drift.ok, false);
      assert.ok(report.weakenings.length > 0);
      const text = formatStatus(report);
      assert.match(text, /WEAKER than committed/);
      assert.match(text, /unprotected-file/);
    });
  } catch (err) {
    t.skip(`git unavailable: ${err.message}`);
  }
});
