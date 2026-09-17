import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONFIG, mergeConfig } from '../src/config.js';
import { inspectSource } from '../src/inspect.js';

const regexCfg = mergeConfig(CONFIG, { astRules: { goForbidPanic: true } });
const astCfg = mergeConfig(CONFIG, { engine: 'ast-grep', astRules: { goForbidPanic: true } });

function hit(file, code, config = regexCfg) {
  return inspectSource(file, code, config);
}

describe('alias-class evasions', () => {
  it('Python AST flags getattr(__builtins__, "eval")', () => {
    const errors = hit('app.py', 'getattr(__builtins__, "eval")(x)');
    assert.ok(errors.length >= 1);
    assert.match(errors.join(' '), /eval/);
  });

  it('Java flags Runtime.exec after a local alias (regex and ast-grep)', () => {
    const code = 'Runtime rt = Runtime.getRuntime();\nrt.exec("rm");';
    assert.ok(hit('a.java', code, regexCfg).length >= 1);
    assert.ok(hit('a.java', code, astCfg).length >= 1);
  });

  it('C still misses gets via function pointer (regex and ast-grep)', () => {
    const code = 'char *(*p)(char *) = gets;\np(buf);';
    assert.deepEqual(hit('a.c', code, regexCfg), []);
    assert.deepEqual(hit('a.c', code, astCfg), []);
  });

  it('C++ std::system is flagged by regex and ast-grep', () => {
    const code = 'std::system("ls");';
    assert.ok(hit('a.cpp', code, regexCfg).length >= 1);
    assert.ok(hit('a.cpp', code, astCfg).length >= 1);
  });

  it('Kotlin misses aliased TODO() (regex and ast-grep)', () => {
    const code = 'val t = TODO\nt()';
    assert.deepEqual(hit('a.kt', code, regexCfg), []);
    assert.deepEqual(hit('a.kt', code, astCfg), []);
  });

  it('Go cannot assign builtin panic; foo.panic is a regex false hit, ast-grep clean', () => {
    const code = 'func f() { foo.panic("x") }';
    assert.ok(hit('a.go', code, regexCfg).length >= 1);
    assert.deepEqual(hit('a.go', code, astCfg), []);
  });
});

describe('policy-scope misses (not aliases — SOP never claimed these)', () => {
  it('Rust unsafe fn / impl / trait are not unsafe { } blocks', () => {
    for (const code of ['unsafe fn f() { x(); }', 'unsafe impl Send for T {}', 'unsafe trait Foo {}']) {
      assert.deepEqual(hit('a.rs', code, regexCfg), []);
      assert.deepEqual(hit('a.rs', code, astCfg), []);
    }
  });

  it('Java ProcessBuilder.start is out of the Runtime.exec rule', () => {
    const code = 'new ProcessBuilder("rm").start();';
    assert.deepEqual(hit('a.java', code, regexCfg), []);
    assert.deepEqual(hit('a.java', code, astCfg), []);
  });
});

describe('string/comment immunity (ast-grep better; regex over-flags)', () => {
  it('Rust/Go string mentions: regex flags, ast-grep does not', () => {
    assert.ok(hit('a.rs', 'let w = "unsafe { }";', regexCfg).length >= 1);
    assert.deepEqual(hit('a.rs', 'let w = "unsafe { }";', astCfg), []);
    assert.ok(hit('a.go', 's := "panic(x)"', regexCfg).length >= 1);
    assert.deepEqual(hit('a.go', 's := "panic(x)"', astCfg), []);
  });

  it('Python AST does not flag eval inside a string', () => {
    assert.deepEqual(hit('app.py', 's = "eval(x)"'), []);
  });
});
