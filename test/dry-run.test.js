import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { CONFIG } from '../src/config.js';
import { evaluatePreToolUse } from '../src/pre-tool-use.js';
import { explainConfig, runDryTest } from '../src/dry-run.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'bin/governor.js');

function runGovernor(args, { cwd } = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: cwd || repoRoot,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd || repoRoot },
  });
}

describe('dry-run test CLI (T1.4)', () => {
  it('denies git push --force with forbidden-bash ruleId', () => {
    const report = runDryTest(
      { command: 'git push --force' },
      { config: CONFIG, projectRoot: '/repo' }
    );
    assert.equal(report.decision, 'deny');
    assert.equal(report.ruleId, 'forbidden-bash');
    assert.match(report.reason, /violates repository safety rules/);
    assert.ok(report.suggestion);
  });

  it('matches evaluatePreToolUse for the same bash command (contract)', () => {
    const command = 'git push --force origin main';
    const hook = evaluatePreToolUse(
      { tool_name: 'Bash', tool_input: { command } },
      CONFIG,
      '/repo'
    );
    const report = runDryTest({ command }, { config: CONFIG, projectRoot: '/repo' });
    assert.equal(report.exitCode, hook.exitCode);
    assert.equal(report.decision, hook.action);
    assert.equal(report.ruleId, hook.ruleId);
  });

  it('denies --file tsconfig.json --operation modify', () => {
    const report = runDryTest(
      { file: 'tsconfig.json', operation: 'modify' },
      { config: CONFIG, projectRoot: '/repo' }
    );
    assert.equal(report.decision, 'deny');
    assert.equal(report.ruleId, 'protected-file');
  });

  it('prints JSON from the CLI for git push --force', () => {
    const result = runGovernor(['test', '--command', 'git push --force', '--json']);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.decision, 'deny');
    assert.equal(parsed.ruleId, 'forbidden-bash');
  });
});

describe('explain CLI', () => {
  it('lists compiled rule ids from the default policy', () => {
    const text = explainConfig(CONFIG);
    assert.match(text, /protected-file/);
    assert.match(text, /forbidden-bash/);
    assert.match(text, /defaultAction: allow/);
  });

  it('reads --config and prints rule ids', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-explain-'));
    const configPath = path.join(tmp, 'governor.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ protectedFiles: ['only-me.lock'] }));
    const result = runGovernor(['explain', '--config', configPath]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /protected-file/);
  });
});
