import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { CONFIG } from '../src/config.js';
import { evaluatePreToolUse } from '../src/pre-tool-use.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runPython(payload, cwd) {
  return spawnSync('python3', [path.join(repoRoot, 'python/pre_tool_use.py')], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  });
}

const SHARED_DENY = [
  'git push --force',
  'git push --force origin main',
  'git push -f origin main',
  'git commit -m x --no-verify',
  'git push origin main --no-verify',
  'rm -rf .git',
  'npm set strict-ssl false',
  'pip install --insecure torch',
  'cargo publish --no-verify',
];

describe('Python/Node bash decision alignment (T2.3)', () => {
  for (const command of SHARED_DENY) {
    it(`agrees to deny: ${command}`, () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-py-align-'));
      const node = evaluatePreToolUse(
        { tool_name: 'Bash', tool_input: { command } },
        CONFIG,
        tmp
      );
      const py = runPython({ tool_name: 'Bash', tool_input: { command } }, tmp);
      assert.equal(node.exitCode, 2, `node should deny ${command}`);
      assert.equal(py.status, 2, `python should deny ${command}: ${py.stderr}`);
    });
  }

  it('blocks git push --force on the Python runtime', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-py-force-'));
    const py = runPython(
      { tool_name: 'Bash', tool_input: { command: 'git push --force' } },
      tmp
    );
    assert.equal(py.status, 2, py.stderr);
    assert.match(py.stderr, /GOVERNOR BLOCK/);
  });

  it('does not miss a multiline --no-verify (DOTALL)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-py-ml-'));
    const command = 'git commit -m "wip"\n--no-verify';
    const py = runPython({ tool_name: 'Bash', tool_input: { command } }, tmp);
    assert.equal(py.status, 2, py.stderr);
  });

  it('tags python-side capability subset for force-push and rm', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-py-cap-'));
    const force = runPython(
      { tool_name: 'Bash', tool_input: { command: 'git push --force' } },
      tmp
    );
    const wipe = runPython(
      { tool_name: 'Bash', tool_input: { command: '/bin/rm -rf .git' } },
      tmp
    );
    assert.match(force.stderr, /git\.push\.force|GOVERNOR BLOCK/);
    assert.match(wipe.stderr, /fs\.delete|GOVERNOR BLOCK/);
  });
});
