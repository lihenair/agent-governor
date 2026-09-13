import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { CONFIG } from '../src/config.js';
import { evaluatePreToolUse } from '../src/pre-tool-use.js';
import { computeHashes, ensureSelfProtect, verifyHashes } from '../src/self-protect.js';

function tmpRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-self-'));
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude/settings.json'), '{"hooks":{}}\n');
  fs.writeFileSync(path.join(root, 'governor.config.json'), '{"protectedFiles":["tsconfig.json"]}\n');
  return root;
}

describe('self-protect hashes (T1.2)', () => {
  it('fails verify after governor.config.json is changed', () => {
    const root = tmpRepo();
    const stored = computeHashes(root);
    fs.writeFileSync(path.join(root, 'governor.config.json'), '{"protectedFiles":[]}\n');
    const result = verifyHashes(root, stored);
    assert.equal(result.ok, false);
    assert.ok(result.mismatches.some((item) => item.path === 'governor.config.json'));
  });

  it('writes self-hash.json on first run and matches afterwards', () => {
    const root = tmpRepo();
    const first = ensureSelfProtect(root);
    assert.equal(first.ok, true);
    assert.equal(first.initialized, true);
    assert.ok(fs.existsSync(path.join(root, '.agent-governor/self-hash.json')));

    const second = ensureSelfProtect(root);
    assert.equal(second.ok, true);
    assert.equal(second.initialized, false);
    assert.equal(second.mismatches.length, 0);
  });

  it('warns but stays open on mismatch when failureMode is open', () => {
    const root = tmpRepo();
    ensureSelfProtect(root);
    fs.writeFileSync(path.join(root, '.claude/settings.json'), '{"hooks":{"tampered":true}}\n');
    const result = ensureSelfProtect(root, { failureMode: 'open' });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 0);
    assert.match(result.warning, /self-hash mismatch/);
    assert.match(result.warning, /\.claude\/settings\.json/);
  });

  it('fails closed on mismatch when failureMode is closed', () => {
    const root = tmpRepo();
    ensureSelfProtect(root);
    fs.writeFileSync(path.join(root, 'governor.config.json'), '{}\n');
    const result = ensureSelfProtect(root, { failureMode: 'closed' });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 2);
  });
});

describe('self-protect live path fallback', () => {
  it('denies an agent Write to .claude/settings.json', () => {
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

  it('allows writing ordinary business source', () => {
    const result = evaluatePreToolUse(
      {
        tool_name: 'Write',
        tool_input: { file_path: '/repo/src/app.js', content: 'export const ok = 1;\n' },
      },
      CONFIG,
      '/repo'
    );
    assert.equal(result.exitCode, 0);
  });
});
