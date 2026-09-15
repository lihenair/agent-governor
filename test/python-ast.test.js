import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectPython } from '../src/inspect.js';

const CONFIG = { astRules: { pythonForbiddenCalls: ['eval', 'exec'], pythonDeprecatedImports: ['imp', 'optparse'] } };

test('python-ast: direct eval is flagged with line number', () => {
  const errors = inspectPython('app.py', 'eval(expr)', CONFIG);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Line 1: Direct use of 'eval\(\)'/);
});

test('python-ast: exec flagged', () => {
  const errors = inspectPython('app.py', 'exec(code)', CONFIG);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /'exec\(\)'/);
});

test('python-ast: aliased eval is caught (regex could not)', () => {
  const errors = inspectPython('app.py', 'e = eval\ne(expr)', CONFIG);
  assert.ok(errors.length >= 1);
  assert.match(errors.join(' '), /aliases banned 'eval\(\)'/);
});

test('python-ast: attribute call builtins.eval is caught (regex could not)', () => {
  const errors = inspectPython('app.py', 'import builtins\nbuiltins.eval(x)', CONFIG);
  assert.ok(errors.length >= 1);
  assert.match(errors.join(' '), /attribute/);
});

test('python-ast: computed lookup globals()["eval"] is caught (regex could not)', () => {
  const errors = inspectPython('app.py', 'globals()["eval"](x)', CONFIG);
  assert.ok(errors.length >= 1);
  assert.match(errors.join(' '), /Computed lookup/);
});

test('python-ast: deprecated import flagged', () => {
  const errors = inspectPython('app.py', 'import imp', CONFIG);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /deprecated module 'imp'/);
});

test('python-ast: from-import flagged', () => {
  const errors = inspectPython('app.py', 'from optparse import OptionParser', CONFIG);
  assert.equal(errors.length, 1);
});

test('python-ast: benign code passes clean', () => {
  const errors = inspectPython('app.py', 'x = 1 + 1\nprint(x)\nimport json', CONFIG);
  assert.deepEqual(errors, []);
});

test('python-ast: custom banned calls honored', () => {
  const errors = inspectPython(
    'app.py',
    'marshal.loads(b)',
    { astRules: { pythonForbiddenCalls: ['marshal'], pythonDeprecatedImports: [] } }
  );
  assert.equal(errors.length, 1);
});

test('python-ast: syntax-error fragment falls back to regex and still catches eval', () => {
  // A partial snippet with a syntax error but a literal eval call.
  const errors = inspectPython('app.py', 'def broken(:\n    eval(x)', CONFIG);
  assert.ok(errors.length >= 1, 'regex fallback should catch eval');
  assert.match(errors.join(' '), /eval/);
});

test('python-ast: syntax-error fragment without banned content passes', () => {
  const errors = inspectPython('app.py', 'def broken(:', CONFIG);
  assert.deepEqual(errors, []);
});

test('python-ast: comments and strings no longer cause false positives', () => {
  // The old regex-only path stripped comments; a string like s = "eval(x) is bad"
  // would false-positive. AST understands it is not a call.
  const errors = inspectPython('app.py', 's = "eval(x) is bad"\n# eval(x) in comment', CONFIG);
  assert.deepEqual(errors, []);
});
