import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONFIG } from '../src/config.js';
import { evaluate } from '../src/policy/engine.js';
import { validatePolicy } from '../src/policy/schema.js';
import { compilePreToolPolicy } from '../src/policy/rules.js';
import { evaluatePreToolUse } from '../src/pre-tool-use.js';

function denyRule(id, reason = `blocked by ${id}`) {
  return {
    id,
    action: 'deny',
    match: (ctx) => ctx.toolName === 'Bash' && ctx.command === 'boom',
    reason,
  };
}

describe('validatePolicy', () => {
  it('accepts a minimal valid policy', () => {
    const result = validatePolicy({
      rules: [{ id: 'r1', action: 'allow', match: () => false }],
      defaultAction: 'allow',
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it('rejects missing rules and illegal actions', () => {
    assert.equal(validatePolicy(null).ok, false);
    assert.equal(validatePolicy({}).ok, false);
    const bad = validatePolicy({
      rules: [{ id: '', action: 'explode', match: 'nope' }],
      defaultAction: 'maybe',
    });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((error) => /id/i.test(error)));
    assert.ok(bad.errors.some((error) => /action/i.test(error)));
    assert.ok(bad.errors.some((error) => /match/i.test(error)));
  });
});

describe('evaluate — three-state engine', () => {
  it('returns allow when a matching rule says so', () => {
    const decision = evaluate(
      { toolName: 'Read', command: '' },
      {
        defaultAction: 'deny',
        rules: [
          {
            id: 'allow-read',
            action: 'allow',
            match: (ctx) => ctx.toolName === 'Read',
            reason: 'reads are fine',
          },
        ],
      }
    );
    assert.deepEqual(decision, {
      action: 'allow',
      reason: 'reads are fine',
      ruleId: 'allow-read',
    });
  });

  it('returns deny with the matching ruleId', () => {
    const decision = evaluate({ toolName: 'Bash', command: 'boom' }, { rules: [denyRule('no-boom')] });
    assert.equal(decision.action, 'deny');
    assert.equal(decision.ruleId, 'no-boom');
    assert.match(decision.reason, /no-boom/);
  });

  it('returns ask without performing IO', () => {
    const decision = evaluate(
      { toolName: 'Bash', command: 'python -c "print(1)"' },
      {
        rules: [
          {
            id: 'dynamic-spawn',
            action: 'ask',
            match: (ctx) => /python\s+-c/.test(ctx.command),
            reason: 'dynamic interpreter spawn',
          },
        ],
      }
    );
    assert.equal(decision.action, 'ask');
    assert.equal(decision.ruleId, 'dynamic-spawn');
  });

  it('returns default allow and null ruleId when nothing matches', () => {
    const decision = evaluate(
      { toolName: 'Bash', command: 'npm test' },
      { rules: [denyRule('no-boom')], defaultAction: 'allow' }
    );
    assert.deepEqual(decision, {
      action: 'allow',
      reason: 'no matching rule',
      ruleId: null,
    });
  });

  it('uses compiled default policy to deny protected files and allow source edits', () => {
    const policy = compilePreToolPolicy(CONFIG);
    const schema = validatePolicy(policy);
    assert.equal(schema.ok, true);

    const deny = evaluate(
      {
        toolName: 'Edit',
        filePaths: ['/repo/tsconfig.json'],
        snippets: [],
        command: '',
        projectRoot: '/repo',
      },
      policy
    );
    assert.equal(deny.action, 'deny');
    assert.equal(deny.ruleId, 'protected-file');

    const allow = evaluate(
      {
        toolName: 'Edit',
        filePaths: ['/repo/src/app.ts'],
        snippets: [],
        command: '',
        projectRoot: '/repo',
      },
      policy
    );
    assert.equal(allow.action, 'allow');
    assert.equal(allow.ruleId, null);
  });
});

describe('evaluatePreToolUse delegates to evaluate', () => {
  it('still blocks tsconfig.json and surfaces the protected-file ruleId', () => {
    const result = evaluatePreToolUse(
      {
        tool_name: 'Edit',
        tool_input: { file_path: '/repo/tsconfig.json', old_string: 'a', new_string: 'b' },
      },
      CONFIG,
      '/repo'
    );
    assert.equal(result.exitCode, 2);
    assert.equal(result.ruleId, 'protected-file');
    assert.equal(result.action, 'deny');
  });
});
