import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONFIG } from '../src/config.js';
import { evaluatePreToolUse } from '../src/pre-tool-use.js';

function bash(command) {
  return evaluatePreToolUse(
    { tool_name: 'Bash', tool_input: { command } },
    CONFIG,
    '/repo'
  );
}

describe('bash write-path coverage (T1.5)', () => {
  const cases = [
    ['sed -i', "sed -i 's/true/false/' tsconfig.json"],
    ['sed --in-place', "sed --in-place 's/true/false/' tsconfig.json"],
    ['git restore', 'git restore tsconfig.json'],
    ['git checkout --', 'git checkout -- package.json'],
    ['cp', 'cp /tmp/evil.json package.json'],
    ['mv', 'mv /tmp/evil.json tsconfig.json'],
    ['jq redirect already covered', 'jq ".strict=false" tsconfig.json > tsconfig.json'],
    ['jq in-place file arg', 'jq ".strict=false" tsconfig.json'],
    ['npm pkg set', 'npm pkg set type=commonjs'],
    ['yarn config set', 'yarn config set ignore-engines true'],
  ];

  for (const [label, command] of cases) {
    it(`denies ${label}: ${command}`, () => {
      const result = bash(command);
      assert.equal(result.exitCode, 2, `${label} should deny: ${command}\n${result.stderr || ''}`);
      assert.match(result.stderr || '', /GOVERNOR BLOCK/);
    });
  }

  it('denies both sed -i and sed --in-place on the same protected file', () => {
    assert.equal(bash("sed -i 's/a/b/' tsconfig.json").exitCode, 2);
    assert.equal(bash("sed --in-place 's/a/b/' tsconfig.json").exitCode, 2);
  });

  it('still allows cat of a protected file', () => {
    assert.equal(bash('cat tsconfig.json').exitCode, 0);
  });

  it('allows cp to a non-protected destination', () => {
    assert.equal(bash('cp package.json /tmp/backup.json').exitCode, 0);
  });
});
