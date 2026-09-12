import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { initProject, mergeHookSettings } from '../src/init.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'bin/governor.js');

function runGovernor(args, { input, cwd } = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: cwd || repoRoot,
    input,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd || repoRoot },
  });
}

describe('init', () => {
  it('injects hooks without dropping existing settings', () => {
    const merged = mergeHookSettings({
      permissions: { allow: ['Bash'] },
      hooks: {
        PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'echo ok' }] }],
      },
    });
    assert.equal(merged.permissions.allow[0], 'Bash');
    assert.equal(merged.hooks.PreToolUse.length, 2);
    assert.equal(merged.hooks.PostToolUse.length, 1);
  });

  it('writes .claude/settings.json and governor.config.cjs', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-init-'));
    const result = initProject(tmp);
    assert.ok(fs.existsSync(result.settingsPath));
    assert.ok(fs.existsSync(result.configPath));
    const settings = JSON.parse(fs.readFileSync(result.settingsPath, 'utf8'));
    assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /pre-check/);
  });
});

describe('CLI integration', () => {
  it('pre-check exits 2 for protected file edits', () => {
    const result = runGovernor(['pre-check'], {
      input: JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: `${repoRoot}/package.json` },
      }),
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /GOVERNOR BLOCK/);
  });

  it('pre-check exits 0 for source edits', () => {
    const result = runGovernor(['pre-check'], {
      input: JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: `${repoRoot}/src/app.ts` },
      }),
    });
    assert.equal(result.status, 0, result.stderr);
  });

  it('post-check exits 2 when the written file contains eval', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-post-'));
    const filePath = path.join(tmp, 'hack.ts');
    fs.writeFileSync(filePath, 'export const x = eval("1");\n');
    const result = runGovernor(['post-check'], {
      cwd: tmp,
      input: JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: filePath, content: 'export const x = eval("1");\n' },
      }),
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /AST Check Failed/);
  });

  it('prints version', () => {
    const result = runGovernor(['version']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^\d+\.\d+\.\d+/);
  });

  it('fail-opens on invalid JSON stdin', () => {
    const result = runGovernor(['pre-check'], { input: 'not-json{' });
    assert.equal(result.status, 0, result.stderr);
  });
});
