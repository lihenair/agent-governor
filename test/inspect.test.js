import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONFIG, mergeConfig } from '../src/config.js';
import { evaluateHook } from '../src/dispatch.js';
import { inspectSource, languageIdFor } from '../src/inspect.js';
import { evaluatePreToolUse } from '../src/pre-tool-use.js';
import { evaluatePostToolUse } from '../src/post-tool-use.js';

describe('language dispatcher', () => {
  it('maps extensions to language ids', () => {
    assert.equal(languageIdFor('a.ts'), 'javascript');
    assert.equal(languageIdFor('a.py'), 'python');
    assert.equal(languageIdFor('a.rs'), 'rust');
    assert.equal(languageIdFor('a.go'), 'go');
    assert.equal(languageIdFor('a.dart'), 'dart');
    assert.equal(languageIdFor('a.swift'), 'swift');
    assert.equal(languageIdFor('a.kt'), 'kotlin');
    assert.equal(languageIdFor('a.cpp'), 'cpp');
    assert.equal(languageIdFor('a.java'), 'java');
    assert.equal(languageIdFor('a.md'), null);
  });

  it('blocks Python eval, Rust unsafe, Dart mirrors, Swift try!, Kotlin !!, C gets, Java exec', () => {
    assert.ok(inspectSource('x.py', 'print(eval("1"))\n', CONFIG).length > 0);
    assert.ok(inspectSource('x.rs', 'pub fn f() { unsafe { 1 } }\n', CONFIG).length > 0);
    assert.ok(inspectSource('x.dart', "import 'dart:mirrors';\n", CONFIG).length > 0);
    assert.ok(inspectSource('x.swift', 'try! boom()\n', CONFIG).length > 0);
    assert.ok(inspectSource('x.kt', 'val x = name!!\n', CONFIG).length > 0);
    assert.ok(inspectSource('x.c', 'gets(buf);\n', CONFIG).length > 0);
    assert.ok(inspectSource('x.java', 'Runtime.getRuntime().exec("rm");\n', CONFIG).length > 0);
  });

  it('does not block Go panic unless enabled', () => {
    assert.deepEqual(inspectSource('x.go', 'func f() { panic("x") }\n', CONFIG), []);
    const enabled = mergeConfig(CONFIG, { astRules: { goForbidPanic: true } });
    assert.ok(inspectSource('x.go', 'func f() { panic("x") }\n', enabled).length > 0);
  });

  it('honors JSON-style disables', () => {
    const off = mergeConfig(CONFIG, {
      astRules: {
        rustForbidUnsafe: false,
        dartForbidMirrors: false,
        kotlinForbidBangBang: false,
      },
    });
    assert.deepEqual(inspectSource('x.rs', 'unsafe { 1 }\n', off), []);
    assert.deepEqual(inspectSource('x.dart', "import 'dart:mirrors';\n", off), []);
    assert.deepEqual(inspectSource('x.kt', 'val x = name!!\n', off), []);
  });
});

describe('pre-check inspects Write payloads before disk', () => {
  it('blocks a Rust unsafe Write', () => {
    const result = evaluatePreToolUse(
      {
        tool_name: 'Write',
        tool_input: {
          file_path: '/repo/src/lib.rs',
          content: 'pub fn f() { unsafe { 1 } }\n',
        },
      },
      CONFIG,
      '/repo'
    );
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /unsafe/);
  });
});

describe('post-check inspects polyglot files on disk', () => {
  it('blocks Dart mirrors after Write', () => {
    const files = new Map([['/repo/lib/main.dart', "import 'dart:mirrors';\n"]]);
    const result = evaluatePostToolUse(
      { tool_name: 'Write', tool_input: { file_path: '/repo/lib/main.dart' } },
      CONFIG,
      {
        existsSync: (filePath) => files.has(filePath),
        readFileSync: (filePath) => files.get(filePath),
      }
    );
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /dart:mirrors/);
  });
});

describe('hook dispatcher', () => {
  it('routes PostToolUse to the post inspector', async () => {
    const files = new Map([['/repo/a.ts', 'export const x = eval("1");\n']]);
    const result = await evaluateHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: { file_path: '/repo/a.ts' },
      },
      CONFIG,
      '/repo',
      {
        existsSync: (filePath) => files.has(filePath),
        readFileSync: (filePath) => files.get(filePath),
      }
    );
    assert.equal(result.exitCode, 2);
  });

  it('routes missing event name to pre-check', async () => {
    const result = await evaluateHook(
      {
        tool_name: 'Edit',
        tool_input: { file_path: '/repo/tsconfig.json' },
      },
      CONFIG,
      '/repo'
    );
    assert.equal(result.exitCode, 2);
  });
});
