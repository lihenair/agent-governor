import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Readable } from 'node:stream';
import { previewInput, redact } from '../src/audit/redact.js';
import { AUDIT_MAX_BYTES, logDecision } from '../src/audit/logger.js';
import { runPreToolUseGuard } from '../src/pre-tool-use.js';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gov-audit-'));
}

describe('audit redact', () => {
  it('replaces token/key/secret/password/authorization and well-known prefixes', () => {
    const sample =
      'token=abc123 key: super-secret password="hunter2" Authorization: Bearer xyz ghp_ABCDEFG sk-LIVESECRET';
    const out = redact(sample);
    assert.equal(out.includes('abc123'), false);
    assert.equal(out.includes('hunter2'), false);
    assert.equal(out.includes('xyz'), false);
    assert.equal(out.includes('ABCDEFG'), false);
    assert.equal(out.includes('LIVESECRET'), false);
    assert.match(out, /token=/i);
    assert.match(out, /\*\*\*/);
  });

  it('truncates input_preview to 200 characters after redaction', () => {
    const preview = previewInput({ command: 'x'.repeat(500) });
    assert.equal(preview.length, 200);
  });
});

describe('audit logger', () => {
  it('appends a parseable JSONL record with the required fields', () => {
    const root = tmpRoot();
    const input = { command: 'git push --force' };
    const record = logDecision(
      {
        session: 'sess-1',
        hook: 'PreToolUse',
        tool: 'Bash',
        input,
        decision: 'deny',
        rule_id: 'forbidden-bash',
        reason: 'force push',
        duration_ms: 4,
        cwd: root,
        branch: 'main',
        failure_mode: 'open',
      },
      { repoRoot: root, now: new Date('2026-09-12T16:00:00.000Z') }
    );

    const required = [
      'ts',
      'session',
      'hook',
      'tool',
      'input_hash',
      'input_preview',
      'decision',
      'rule_id',
      'reason',
      'duration_ms',
      'cwd',
      'branch',
      'failure_mode',
    ];
    for (const key of required) {
      assert.ok(key in record, key);
    }

    const raw = fs.readFileSync(path.join(root, '.agent-governor/audit.log'), 'utf8');
    const parsed = JSON.parse(raw.trim());
    assert.equal(parsed.decision, 'deny');
    assert.equal(parsed.rule_id, 'forbidden-bash');
    assert.equal(parsed.session, 'sess-1');
    assert.equal(
      parsed.input_hash,
      crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')
    );
    assert.equal(raw.includes('git push --force') && parsed.input_preview.includes('git push'), true);
    assert.equal(JSON.parse(raw.trim()).command, undefined);
  });

  it('rotates audit.log to audit.log.1 once the file exceeds 10MB', () => {
    const root = tmpRoot();
    const dir = path.join(root, '.agent-governor');
    fs.mkdirSync(dir, { recursive: true });
    const logFile = path.join(dir, 'audit.log');
    fs.writeFileSync(logFile, 'x'.repeat(AUDIT_MAX_BYTES + 1));

    logDecision(
      { tool: 'Bash', input: { command: 'npm test' }, decision: 'allow' },
      { repoRoot: root }
    );

    assert.ok(fs.existsSync(path.join(dir, 'audit.log.1')));
    assert.ok(fs.statSync(path.join(dir, 'audit.log.1')).size > AUDIT_MAX_BYTES);
    const fresh = fs.readFileSync(logFile, 'utf8').trim();
    assert.equal(JSON.parse(fresh).decision, 'allow');
    assert.ok(fs.statSync(logFile).size < AUDIT_MAX_BYTES);
  });
});

describe('audit integration', () => {
  it('writes a deny record when pre-check blocks a protected file', async () => {
    const root = tmpRoot();
    const previous = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = root;
    const stdin = Readable.from([
      JSON.stringify({
        tool_name: 'Edit',
        cwd: root,
        session_id: 'abc123',
        tool_input: { file_path: path.join(root, 'package.json') },
      }),
    ]);
    try {
      const result = await runPreToolUseGuard({ stdin });
      assert.equal(result.exitCode, 2);

      const lines = fs
        .readFileSync(path.join(root, '.agent-governor/audit.log'), 'utf8')
        .trim()
        .split('\n');
      const last = JSON.parse(lines[lines.length - 1]);
      assert.equal(last.decision, 'deny');
      assert.equal(last.tool, 'Edit');
      assert.equal(last.hook, 'PreToolUse');
      assert.equal(last.session, 'abc123');
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_PROJECT_DIR;
      } else {
        process.env.CLAUDE_PROJECT_DIR = previous;
      }
    }
  });
});
