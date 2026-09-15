import assert from 'node:assert/strict';
import { test } from 'node:test';
import { astGrepSupports, inspectWithAstGrep } from '../src/ast-grep-engine.js';
import { inspectSource } from '../src/inspect.js';

const ENGINE_ON = { engine: 'ast-grep', astRules: {} };

test('ast-grep: rust unsafe block flagged structurally', () => {
  assert.ok(astGrepSupports('a.rs'));
  const errors = inspectWithAstGrep('a.rs', 'fn main() {\n  unsafe { x(); }\n}', ENGINE_ON);
  assert.ok(errors.length >= 1);
  assert.match(errors[0], /unsafe/);
  assert.match(errors[0], /Line 2/);
});

test('ast-grep: rust string mentioning unsafe is NOT flagged (regex would)', () => {
  const errors = inspectWithAstGrep('a.rs', 'let w = "never write unsafe { } blocks";', ENGINE_ON);
  assert.deepEqual(errors, []);
});

test('ast-grep: rust comment mentioning unsafe is NOT flagged', () => {
  const errors = inspectWithAstGrep('a.rs', '// TODO: remove unsafe { } here', ENGINE_ON);
  assert.deepEqual(errors, []);
});

test('ast-grep: go panic flagged; string panic not flagged', () => {
  const cfg = { ...ENGINE_ON, astRules: { goForbidPanic: true } };
  const hit = inspectWithAstGrep('a.go', 'func f() { panic("boom") }', cfg);
  assert.ok(hit.length >= 1);
  assert.match(hit[0], /panic/);

  const miss = inspectWithAstGrep('a.go', 's := "call panic(x) now"', cfg);
  assert.deepEqual(miss, []);
});

test('ast-grep: kotlin !! postfix flagged; string not flagged', () => {
  const hit = inspectWithAstGrep('a.kt', 'val x = map["key"]!!', ENGINE_ON);
  assert.ok(hit.length >= 1);
  assert.match(hit[0], /force unwrap/);

  const miss = inspectWithAstGrep('a.kt', 'val s = "use !! carefully"', ENGINE_ON);
  assert.deepEqual(miss, []);
});

test('ast-grep: swift try! flagged via try_operator node; string not flagged', () => {
  const hit = inspectWithAstGrep('a.swift', 'let v = try! risky()', ENGINE_ON);
  assert.ok(hit.length >= 1);
  assert.match(hit[0], /force-try/);

  const miss = inspectWithAstGrep('a.swift', 'let s = "try! is dangerous"', ENGINE_ON);
  assert.deepEqual(miss, []);
});

test('ast-grep: C gets() flagged; string mention not flagged', () => {
  const hit = inspectWithAstGrep('a.c', 'char *p;\ngets(p);', ENGINE_ON);
  assert.ok(hit.length >= 1);
  assert.match(hit[0], /gets/);

  const miss = inspectWithAstGrep('a.c', 'printf("never call gets(x)");', ENGINE_ON);
  assert.deepEqual(miss, []);
});

test('ast-grep: cpp system() flagged', () => {
  const hit = inspectWithAstGrep('a.cpp', 'int main() { system("ls"); }', ENGINE_ON);
  assert.ok(hit.length >= 1);
  assert.match(hit[0], /system/);
});

test('ast-grep: dart mirrors import flagged', () => {
  const hit = inspectWithAstGrep('a.dart', "import 'dart:mirrors';", ENGINE_ON);
  assert.ok(hit.length >= 1);
  assert.match(hit[0], /dart:mirrors/);
});

test('ast-grep: rule disable flags honored (rustForbidUnsafe: false)', () => {
  const errors = inspectWithAstGrep(
    'a.rs',
    'fn main() { unsafe { x(); } }',
    { engine: 'ast-grep', astRules: { rustForbidUnsafe: false } }
  );
  assert.deepEqual(errors, []);
});

test('ast-grep: inspectSource routes via engine field (integration)', () => {
  const errors = inspectSource(
    'a.rs',
    'fn main() {\n  unsafe { x(); }\n}',
    { ...ENGINE_ON }
  );
  assert.ok(errors.length >= 1);

  // engine not set → legacy regex path (which also catches this one)
  const legacy = inspectSource('a.rs', 'fn main() {\n  unsafe { x(); }\n}', { astRules: {} });
  assert.ok(legacy.length >= 1);
});

test('ast-grep: JS/TS files are untouched by the ast-grep engine (Babel owns them)', () => {
  const errors = inspectSource('a.js', 'eval(x);', { ...ENGINE_ON });
  // Babel inspector produces the eval error, ast-grep engine does not interfere
  assert.ok(errors.length >= 1);
  assert.match(errors.join(' '), /eval/);
});
