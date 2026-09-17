import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONFIG, mergeConfig } from '../src/config.js';
import { evaluatePostToolUse, inspectAST } from '../src/post-tool-use.js';

describe('inspectAST', () => {
  it('flags direct eval()', () => {
    const errors = inspectAST(
      '/repo/src/hack.ts',
      'export function run(code: string) { return eval(code); }\n',
      CONFIG
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /eval/);
  });

  it('flags new Function()', () => {
    const errors = inspectAST(
      '/repo/src/hack.js',
      'export const fn = new Function("return 1");\n',
      CONFIG
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Function constructor/);
  });

  it('accepts ordinary TypeScript', () => {
    const errors = inspectAST(
      '/repo/src/math.ts',
      'export function add(a: number, b: number): number { return a + b; }\n',
      CONFIG
    );
    assert.deepEqual(errors, []);
  });

  it('reports syntax errors instead of throwing', () => {
    const errors = inspectAST('/repo/src/broken.ts', 'export function oops( {', CONFIG);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Syntax Error/);
  });

  it('skips non-code extensions', () => {
    const errors = inspectAST('/repo/README.md', 'eval("nope")', CONFIG);
    assert.deepEqual(errors, []);
  });

  it('enforces ErrorBoundary on app shells when configured', () => {
    const config = mergeConfig(CONFIG, { astRules: { requireErrorBoundary: true } });
    const errors = inspectAST(
      '/repo/src/App.tsx',
      'export function App() { return <div>hello</div>; }\n',
      config
    );
    assert.ok(errors.some((entry) => /ErrorBoundary/.test(entry)));
  });

  it('honors custom forbiddenCallNames', () => {
    const config = mergeConfig(CONFIG, {
      astRules: { forbiddenCallNames: ['dangerouslySetInnerHTML'] },
    });
    const errors = inspectAST(
      '/repo/src/ui.tsx',
      'dangerouslySetInnerHTML({ __html: "x" });\n',
      config
    );
    assert.ok(errors.some((entry) => /dangerouslySetInnerHTML/.test(entry)));
  });
});

describe('evaluatePostToolUse', () => {
  it('blocks after Write when the file contains eval', () => {
    const files = new Map([
      ['/repo/src/hack.ts', 'export const x = eval("1");\n'],
    ]);
    const result = evaluatePostToolUse(
      { tool_name: 'Write', tool_input: { file_path: '/repo/src/hack.ts', content: '' } },
      CONFIG,
      {
        existsSync: (filePath) => files.has(filePath),
        readFileSync: (filePath) => files.get(filePath),
      }
    );
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /AST Check Failed/);
  });

  it('allows a clean Write', () => {
    const files = new Map([['/repo/src/ok.ts', 'export const n = 1;\n']]);
    const result = evaluatePostToolUse(
      { tool_name: 'Write', tool_input: { file_path: '/repo/src/ok.ts' } },
      CONFIG,
      {
        existsSync: (filePath) => files.has(filePath),
        readFileSync: (filePath) => files.get(filePath),
      }
    );
    assert.equal(result.exitCode, 0);
  });

  it('ignores Bash in the post hook', () => {
    const result = evaluatePostToolUse(
      { tool_name: 'Bash', tool_input: { command: 'eval echo hi' } },
      CONFIG
    );
    assert.equal(result.exitCode, 0);
  });
});
