import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONFIG } from '../src/config.js';
import { inspectAST } from '../src/post-tool-use.js';

function flags(code) {
  return inspectAST('/repo/src/a.ts', code, CONFIG);
}

describe('JS eval aliases (current Babel walk)', () => {
  it('still flags direct eval() and new Function()', () => {
    assert.match(flags('eval(code);')[0], /eval\(\)/);
    assert.match(flags('new Function("return 1");')[0], /new Function/);
  });

  it('does not false-positive on strings or comments', () => {
    assert.deepEqual(flags('const s = "eval(x)";'), []);
    assert.deepEqual(flags('// eval(x)\nconst x = 1;'), []);
  });

  it('misses aliased eval (Python AST catches this shape)', () => {
    assert.deepEqual(flags('const e = eval;\ne(code);'), []);
    assert.deepEqual(flags('var e = eval; e(x);'), []);
  });

  it('misses member and computed eval', () => {
    assert.deepEqual(flags('window.eval(code);'), []);
    assert.deepEqual(flags('globalThis.eval(code);'), []);
    assert.deepEqual(flags('window["eval"](code);'), []);
    assert.deepEqual(flags('globalThis["eval"](code);'), []);
  });

  it('misses indirect eval and optional call', () => {
    assert.deepEqual(flags('(0, eval)(code);'), []);
    assert.deepEqual(flags('eval?.(code);'), []);
  });

  it('misses aliased / member new Function()', () => {
    assert.deepEqual(flags('const F = Function;\nnew F("return 1");'), []);
    assert.deepEqual(flags('new window.Function("return 1");'), []);
    assert.deepEqual(flags('new window["Function"]("return 1");'), []);
  });
});
