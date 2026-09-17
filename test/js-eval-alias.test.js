import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONFIG } from '../src/config.js';
import { inspectAST } from '../src/post-tool-use.js';

function flags(code) {
  return inspectAST('/repo/src/a.ts', code, CONFIG);
}

function flagged(code) {
  const errors = flags(code);
  assert.ok(errors.length >= 1, `expected a hit for ${JSON.stringify(code)}, got ${JSON.stringify(errors)}`);
  return errors;
}

describe('JS eval aliases (Babel walk)', () => {
  it('flags direct eval() and new Function()', () => {
    assert.match(flagged('eval(code);')[0], /eval/);
    assert.match(flagged('new Function("return 1");')[0], /Function constructor/);
  });

  it('does not false-positive on strings or comments', () => {
    assert.deepEqual(flags('const s = "eval(x)";'), []);
    assert.deepEqual(flags('// eval(x)\nconst x = 1;'), []);
  });

  it('flags aliased eval', () => {
    assert.match(flagged('const e = eval;\ne(code);').join('\n'), /eval/);
    assert.match(flagged('var e = eval; e(x);').join('\n'), /eval/);
  });

  it('flags member and computed eval', () => {
    assert.match(flagged('window.eval(code);').join('\n'), /eval/);
    assert.match(flagged('globalThis.eval(code);').join('\n'), /eval/);
    assert.match(flagged('window["eval"](code);').join('\n'), /eval/);
    assert.match(flagged('globalThis["eval"](code);').join('\n'), /eval/);
  });

  it('flags indirect eval and optional call', () => {
    assert.match(flagged('(0, eval)(code);').join('\n'), /eval/);
    assert.match(flagged('eval?.(code);').join('\n'), /eval/);
  });

  it('flags aliased / member Function', () => {
    assert.match(flagged('const F = Function;\nnew F("return 1");').join('\n'), /Function/);
    assert.match(flagged('new window.Function("return 1");').join('\n'), /Function/);
    assert.match(flagged('new window["Function"]("return 1");').join('\n'), /Function/);
    assert.match(flagged('Function("return 1");').join('\n'), /Function/);
  });
});
