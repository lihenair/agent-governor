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

  it('writes .claude/settings.json only when claude-code is selected', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-init-'));
    const result = initProject(tmp, {
      lang: 'node',
      packageRoot: repoRoot,
      hosts: ['claude-code'],
    });
    assert.ok(fs.existsSync(result.settingsPath));
    assert.ok(fs.existsSync(result.configPath));
    const settings = JSON.parse(fs.readFileSync(result.settingsPath, 'utf8'));
    assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /pre-check/);
    assert.ok(result.configPath.endsWith('governor.config.json'));
  });

  it('does not create host dirs when no hosts are selected', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-init-none-'));
    const result = initProject(tmp, { lang: 'node', packageRoot: repoRoot, hosts: [] });
    assert.ok(fs.existsSync(result.configPath));
    assert.equal(fs.existsSync(path.join(tmp, '.claude')), false);
    assert.equal(fs.existsSync(path.join(tmp, '.cursor')), false);
  });

  it('copies Python runtime and wires python hooks', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-py-'));
    fs.writeFileSync(path.join(tmp, 'pyproject.toml'), '[project]\nname="demo"\n');
    const result = initProject(tmp, {
      lang: 'python',
      packageRoot: repoRoot,
      hosts: ['claude-code'],
    });
    assert.deepEqual(result.langs, ['python']);
    assert.ok(fs.existsSync(path.join(tmp, '.agent-governor/python/pre_tool_use.py')));
    assert.ok(fs.existsSync(path.join(tmp, '.agent-governor/python/post_tool_use.py')));
    const settings = JSON.parse(fs.readFileSync(result.settingsPath, 'utf8'));
    const commands = settings.hooks.PreToolUse.flatMap((group) =>
      group.hooks.map((hook) => hook.command)
    );
    assert.ok(commands.some((command) => command.includes('pre_tool_use.py')));
    assert.ok(!commands.some((command) => command.includes('pre-check')));
  });

  it('uses a single dispatcher hook for --lang all', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-all-'));
    const result = initProject(tmp, {
      lang: 'all',
      packageRoot: repoRoot,
      hosts: ['claude-code'],
    });
    const settings = JSON.parse(fs.readFileSync(result.settingsPath, 'utf8'));
    assert.equal(settings.hooks.PreToolUse.length, 1);
    assert.equal(settings.hooks.PostToolUse.length, 1);
    assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /pre-check/);
    assert.equal(fs.existsSync(path.join(tmp, '.cursor/rules/agent-governor.mdc')), false);
  });

  it('writes Cursor hooks.json when cursor is selected', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-cursor-'));
    initProject(tmp, { lang: 'node', packageRoot: repoRoot, hosts: ['cursor'] });
    const hooks = JSON.parse(fs.readFileSync(path.join(tmp, '.cursor/hooks.json'), 'utf8'));
    assert.ok(JSON.stringify(hooks).includes('agent-governor'));
    assert.ok(hooks.hooks.beforeShellExecution);
  });

  it('auto-detects a polyglot repo', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-poly-'));
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"demo"}');
    fs.writeFileSync(path.join(tmp, 'Cargo.toml'), '[package]\nname="demo"\n');
    const result = initProject(tmp, { lang: 'auto', packageRoot: repoRoot, hosts: ['claude-code'] });
    assert.ok(result.langs.includes('node'));
    assert.ok(result.langs.includes('native'));
    assert.ok(fs.existsSync(path.join(tmp, '.agent-governor/native/governor_guard.sh')));
    const settings = JSON.parse(fs.readFileSync(result.settingsPath, 'utf8'));
    assert.equal(settings.hooks.PreToolUse.length, 1);
    assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /pre-check/);
  });

  it('CLI init without --hosts writes policy only', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-cli-init-'));
    const result = runGovernor(['init'], { cwd: tmp });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.ok(fs.existsSync(path.join(tmp, 'governor.config.json')));
    assert.equal(fs.existsSync(path.join(tmp, '.claude')), false);
    assert.match(result.stdout, /No hosts wired/);
  });

  it('CLI init --hosts claude-code wires Claude hooks', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-cli-claude-'));
    const result = runGovernor(['init', '--hosts', 'claude-code'], { cwd: tmp });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.ok(fs.existsSync(path.join(tmp, '.claude/settings.json')));
    assert.match(result.stdout, /Wired hosts: claude-code/);
  });

  it('CLI init --dry-run does not write host files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-cli-dry-'));
    const result = runGovernor(['init', '--hosts', 'cursor', '--dry-run'], { cwd: tmp });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(fs.existsSync(path.join(tmp, '.cursor')), false);
    assert.match(result.stdout, /dry-run/);
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
    const expected = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
    assert.equal(result.stdout.trim(), expected);
  });

  it('prints package version when invoked via an npx-style .bin symlink', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-npx-version-'));
    const binDir = path.join(tmp, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const shim = path.join(binDir, 'agent-governor');
    fs.symlinkSync(cli, shim);
    const result = spawnSync(process.execPath, [shim, 'version'], {
      cwd: tmp,
      encoding: 'utf8',
    });
    const expected = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), expected);
  });

  it('fail-opens on invalid JSON stdin', () => {
    const result = runGovernor(['pre-check'], { input: 'not-json{' });
    assert.equal(result.status, 0, result.stderr);
  });
});
