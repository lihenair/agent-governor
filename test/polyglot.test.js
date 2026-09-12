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

function runPython(script, payload, cwd) {
  return spawnSync('python3', [path.join(repoRoot, 'python', script)], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  });
}

function runNative(payload, cwd) {
  return spawnSync('bash', [path.join(repoRoot, 'native/governor_guard.sh')], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  });
}

describe('polyglot Node defaults', () => {
  it('blocks Python and Rust manifests from Edit', () => {
    for (const fileName of ['pyproject.toml', 'Cargo.toml', 'go.mod', 'pubspec.yaml']) {
      const result = evaluatePreToolUse(
        { tool_name: 'Edit', tool_input: { file_path: `/repo/${fileName}` } },
        CONFIG,
        '/repo'
      );
      assert.equal(result.exitCode, 2, fileName);
    }
  });

  it('blocks pip --insecure and cargo publish --no-verify', () => {
    const pip = evaluatePreToolUse(
      { tool_name: 'Bash', tool_input: { command: 'pip install --insecure torch' } },
      CONFIG,
      '/repo'
    );
    const cargo = evaluatePreToolUse(
      { tool_name: 'Bash', tool_input: { command: 'cargo publish --no-verify' } },
      CONFIG,
      '/repo'
    );
    assert.equal(pip.exitCode, 2);
    assert.equal(cargo.exitCode, 2);
  });
});

describe('Python runtime', () => {
  it('blocks protected Python config files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-py-pre-'));
    const result = runPython(
      'pre_tool_use.py',
      { tool_name: 'Edit', tool_input: { file_path: path.join(tmp, 'pyproject.toml') } },
      tmp
    );
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /GOVERNOR BLOCK/);
  });

  it('blocks git commit --no-verify', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-py-bash-'));
    const result = runPython(
      'pre_tool_use.py',
      { tool_name: 'Bash', tool_input: { command: 'git commit -m x --no-verify' } },
      tmp
    );
    assert.equal(result.status, 2, result.stderr);
  });

  it('flags eval/exec and deprecated imports', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-py-ast-'));
    const filePath = path.join(tmp, 'hack.py');
    fs.writeFileSync(filePath, 'import imp\n\nvalue = eval("1")\n');
    const result = runPython(
      'post_tool_use.py',
      { tool_name: 'Write', tool_input: { file_path: filePath } },
      tmp
    );
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /eval/);
    assert.match(result.stderr, /imp/);
  });

  it('allows clean Python', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-py-ok-'));
    const filePath = path.join(tmp, 'ok.py');
    fs.writeFileSync(filePath, 'def add(a, b):\n    return a + b\n');
    const result = runPython(
      'post_tool_use.py',
      { tool_name: 'Write', tool_input: { file_path: filePath } },
      tmp
    );
    assert.equal(result.status, 0, result.stderr);
  });
});

describe('Native runtime', () => {
  it('blocks Cargo.toml edits', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-nat-cargo-'));
    const result = runNative(
      { tool_name: 'Edit', tool_input: { file_path: path.join(tmp, 'Cargo.toml') } },
      tmp
    );
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /GOVERNOR BLOCK/);
  });

  it('blocks Rust unsafe blocks from Write payload', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-nat-rs-'));
    const result = runNative(
      {
        tool_name: 'Write',
        tool_input: {
          file_path: path.join(tmp, 'src/lib.rs'),
          content: 'pub unsafe fn boom() { unsafe { std::ptr::null() }; }\n',
        },
      },
      tmp
    );
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /unsafe/);
  });

  it('blocks Go panic from existing file when enabled', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-nat-go-'));
    fs.writeFileSync(
      path.join(tmp, 'governor.config.json'),
      JSON.stringify({ astRules: { goForbidPanic: true } })
    );
    const filePath = path.join(tmp, 'main.go');
    fs.writeFileSync(filePath, 'package main\nfunc init() { panic("nope") }\n');
    const result = runNative(
      {
        tool_name: 'Edit',
        hook_event_name: 'PostToolUse',
        tool_input: { file_path: filePath, old_string: 'a', new_string: 'b' },
      },
      tmp
    );
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /panic/);
  });

  it('blocks cargo publish --no-verify', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-nat-pub-'));
    const result = runNative(
      { tool_name: 'Bash', tool_input: { command: 'cargo publish --no-verify' } },
      tmp
    );
    assert.equal(result.status, 2, result.stderr);
  });

  it('allows ordinary Rust source without unsafe', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-nat-ok-'));
    const result = runNative(
      {
        tool_name: 'Write',
        tool_input: {
          file_path: path.join(tmp, 'src/lib.rs'),
          content: 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n',
        },
      },
      tmp
    );
    assert.equal(result.status, 0, result.stderr);
  });
});
