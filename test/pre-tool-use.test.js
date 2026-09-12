import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CONFIG,
  extractFilePaths,
  isProtectedDirectory,
  mergeConfig,
} from '../src/config.js';
import { evaluatePreToolUse } from '../src/pre-tool-use.js';

describe('extractFilePaths', () => {
  it('reads file_path from Edit/Write payloads', () => {
    assert.deepEqual(extractFilePaths('Edit', { file_path: '/repo/src/app.ts' }), [
      '/repo/src/app.ts',
    ]);
  });

  it('collects MultiEdit nested paths', () => {
    assert.deepEqual(
      extractFilePaths('MultiEdit', {
        file_path: '/repo/a.ts',
        edits: [{ file_path: '/repo/b.ts' }],
      }),
      ['/repo/a.ts', '/repo/b.ts']
    );
  });
});

describe('protected directory matching', () => {
  it('blocks files inside .claude/', () => {
    assert.equal(
      isProtectedDirectory('/repo/.claude/settings.json', CONFIG, '/repo'),
      true
    );
  });

  it('does not treat similarly named files as protected dirs', () => {
    assert.equal(
      isProtectedDirectory('/repo/src/not-claude/file.ts', CONFIG, '/repo'),
      false
    );
  });
});

describe('evaluatePreToolUse — config shield', () => {
  it('blocks Edit of tsconfig.json with exit 2', () => {
    const result = evaluatePreToolUse(
      {
        tool_name: 'Edit',
        tool_input: { file_path: '/repo/tsconfig.json', old_string: 'a', new_string: 'b' },
      },
      CONFIG,
      '/repo'
    );
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /GOVERNOR BLOCK/);
    assert.match(result.stderr, /tsconfig\.json/);
  });

  it('blocks Write of package.json', () => {
    const result = evaluatePreToolUse(
      {
        tool_name: 'Write',
        tool_input: { file_path: '/repo/package.json', content: '{}' },
      },
      CONFIG,
      '/repo'
    );
    assert.equal(result.exitCode, 2);
  });

  it('allows ordinary source edits', () => {
    const result = evaluatePreToolUse(
      {
        tool_name: 'Edit',
        tool_input: { file_path: '/repo/src/app.ts' },
      },
      CONFIG,
      '/repo'
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, undefined);
  });

  it('blocks edits under .claude/', () => {
    const result = evaluatePreToolUse(
      {
        tool_name: 'Write',
        tool_input: { file_path: '/repo/.claude/settings.json', content: '{}' },
      },
      CONFIG,
      '/repo'
    );
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /governance infrastructure/);
  });

  it('allows missing payload fields (fail open)', () => {
    assert.equal(evaluatePreToolUse(null, CONFIG, '/repo').exitCode, 0);
    assert.equal(evaluatePreToolUse({}, CONFIG, '/repo').exitCode, 0);
  });
});

describe('evaluatePreToolUse — bash safety', () => {
  it('blocks git commit --no-verify', () => {
    const result = evaluatePreToolUse(
      {
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "wip" --no-verify' },
      },
      CONFIG,
      '/repo'
    );
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /violates repository safety rules/);
  });

  it('blocks rm -rf .git', () => {
    const result = evaluatePreToolUse(
      { tool_name: 'Bash', tool_input: { command: 'rm -rf .git' } },
      CONFIG,
      '/repo'
    );
    assert.equal(result.exitCode, 2);
  });

  it('blocks writing tsconfig.json via shell redirection', () => {
    const result = evaluatePreToolUse(
      {
        tool_name: 'Bash',
        tool_input: { command: 'echo \'{ "strict": false }\' > tsconfig.json' },
      },
      CONFIG,
      '/repo'
    );
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /tsconfig\.json/);
  });

  it('allows npm test', () => {
    const result = evaluatePreToolUse(
      { tool_name: 'Bash', tool_input: { command: 'npm test' } },
      CONFIG,
      '/repo'
    );
    assert.equal(result.exitCode, 0);
  });

  it('allows cat of a protected file (read-only)', () => {
    const result = evaluatePreToolUse(
      { tool_name: 'Bash', tool_input: { command: 'cat tsconfig.json' } },
      CONFIG,
      '/repo'
    );
    assert.equal(result.exitCode, 0);
  });
});

describe('mergeConfig', () => {
  it('extends protected files and bash patterns from user config', () => {
    const merged = mergeConfig(CONFIG, {
      protectedFiles: ['custom.lock'],
      forbiddenBashPatterns: [/drop\s+database/i],
    });
    assert.ok(merged.protectedFiles.includes('tsconfig.json'));
    assert.ok(merged.protectedFiles.includes('custom.lock'));
    const result = evaluatePreToolUse(
      { tool_name: 'Bash', tool_input: { command: 'drop database prod' } },
      merged,
      '/repo'
    );
    assert.equal(result.exitCode, 2);
  });
});
