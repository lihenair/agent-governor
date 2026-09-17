import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { CONFIG, mergeConfig } from '../src/config.js';
import { validateGovernorConfig } from '../src/config-validate.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'bin/governor.js');

describe('config schema validate (T3.1)', () => {
  it('accepts the default CONFIG shape', () => {
    const result = validateGovernorConfig(CONFIG, 'governor.config.json');
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it('reports file, field path, and reason for illegal values', () => {
    const result = validateGovernorConfig(
      { protectedFiles: 'tsconfig.json', failureMode: 'maybe' },
      '/tmp/governor.config.json'
    );
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.path === 'protectedFiles'));
    assert.ok(result.errors.some((error) => error.path === 'failureMode'));
    assert.ok(result.errors.every((error) => error.file === '/tmp/governor.config.json'));
    assert.ok(result.errors[0].reason);
  });

  it('prints path and reason from the validate CLI', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-validate-'));
    const file = path.join(tmp, 'governor.config.json');
    fs.writeFileSync(file, JSON.stringify({ failureMode: 'explode' }));
    const proc = spawnSync(process.execPath, [cli, 'validate', '--config', file], {
      encoding: 'utf8',
      cwd: tmp,
    });
    assert.equal(proc.status, 1, proc.stdout + proc.stderr);
    assert.match(proc.stderr + proc.stdout, /failureMode/);
    assert.match(proc.stderr + proc.stdout, /explode|open|closed/i);
  });
});

describe('failureMode (T3.2)', () => {
  it('defaults to open', () => {
    assert.equal(CONFIG.failureMode, 'open');
    const merged = mergeConfig(CONFIG, {});
    assert.equal(merged.failureMode, 'open');
  });

  it('allows closed via user config', () => {
    const merged = mergeConfig(CONFIG, { failureMode: 'closed' });
    assert.equal(merged.failureMode, 'closed');
  });
});
