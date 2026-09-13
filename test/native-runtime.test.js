import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeHook = path.join(repoRoot, 'native/governor_guard.sh');
const bashPath = process.env.SHELL && process.env.SHELL.endsWith('bash')
  ? process.env.SHELL
  : '/bin/bash';

function runNative({ payload, env, cwd } = {}) {
  return spawnSync(bashPath, [nativeHook], {
    cwd: cwd || repoRoot,
    input: payload === undefined ? JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }) : payload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd || repoRoot, ...env },
  });
}

describe('native python3 runtime gate (T0.1)', () => {
  it('fails closed with exit 2 when python3 is missing from PATH', () => {
    const emptyBin = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-no-python-'));
    const result = runNative({
      env: { PATH: emptyBin },
    });

    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /agent-governor: python3 not found, failing closed/);
  });

  it('does not silently allow a write when python3 is missing', () => {
    const emptyBin = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-no-python-write-'));
    const result = runNative({
      payload: JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: '/repo/Cargo.toml', content: '[package]\nname="x"\n' },
      }),
      env: { PATH: emptyBin },
    });

    assert.equal(result.status, 2);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /python3 not found, failing closed/);
  });

  it('continues when python3 is available', () => {
    const result = runNative({
      payload: JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: '/repo/src/app.rs' },
      }),
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
  });
});
