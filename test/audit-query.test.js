import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { gcAudit, queryAudit } from '../src/audit/query.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'bin/governor.js');

function tmpRepoWithLog(entries, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-audit-query-'));
  const logDir = path.join(dir, '.agent-governor');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(
    path.join(logDir, 'audit.log'),
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
  );
  if (extra.rotated) {
    fs.writeFileSync(
      path.join(logDir, 'audit.log.1'),
      extra.rotated.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
    );
  }
  return dir;
}

function runGovernor(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  });
}

const NOW = new Date('2026-09-17T12:00:00.000Z');

const SAMPLE = [
  {
    ts: '2026-09-16T10:00:00.000Z',
    session: 'sess-old',
    hook: 'PreToolUse',
    tool: 'Bash',
    decision: 'deny',
    rule_id: 'git.push.force',
    reason: 'force push',
  },
  {
    ts: '2026-09-17T10:00:00.000Z',
    session: 'sess-new',
    hook: 'PreToolUse',
    tool: 'Edit',
    decision: 'deny',
    rule_id: 'protected-file',
    reason: 'tsconfig.json',
  },
  {
    ts: '2026-09-17T11:00:00.000Z',
    session: 'sess-new',
    hook: 'PreToolUse',
    tool: 'Bash',
    decision: 'allow',
    rule_id: null,
    reason: '',
  },
];

describe('audit query (T3.3)', () => {
  it('filters by --since relative duration', (t) => {
    const root = tmpRepoWithLog(SAMPLE);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const rows = queryAudit(root, { since: '24h', now: NOW });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].rule_id, 'protected-file');
    assert.equal(rows[1].decision, 'allow');
  });

  it('filters by --decision deny', (t) => {
    const root = tmpRepoWithLog(SAMPLE);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const rows = queryAudit(root, { decision: 'deny', now: NOW });
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.decision === 'deny' || row.decision === 'block'));
  });

  it('filters by --rule', (t) => {
    const root = tmpRepoWithLog(SAMPLE);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const rows = queryAudit(root, { rule: 'git.push.force', now: NOW });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].session, 'sess-old');
  });

  it('filters by --session', (t) => {
    const root = tmpRepoWithLog(SAMPLE);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const rows = queryAudit(root, { session: 'sess-new', now: NOW });
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.session === 'sess-new'));
  });

  it('prints table and json from the audit CLI', (t) => {
    const now = Date.now();
    const root = tmpRepoWithLog([
      {
        ts: new Date(now - 48 * 3600 * 1000).toISOString(),
        session: 'sess-old',
        tool: 'Bash',
        decision: 'deny',
        rule_id: 'git.push.force',
      },
      {
        ts: new Date(now - 3600 * 1000).toISOString(),
        session: 'sess-new',
        tool: 'Edit',
        decision: 'deny',
        rule_id: 'protected-file',
      },
      {
        ts: new Date(now - 30 * 60 * 1000).toISOString(),
        session: 'sess-new',
        tool: 'Bash',
        decision: 'allow',
        rule_id: null,
      },
    ]);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const table = runGovernor(
      ['audit', '--since', '24h', '--decision', 'deny', '--format', 'table'],
      root
    );
    assert.equal(table.status, 0, table.stderr);
    assert.match(table.stdout, /protected-file/);
    assert.match(table.stdout, /deny/);
    assert.doesNotMatch(table.stdout, /git\.push\.force/);

    const json = runGovernor(
      ['audit', '--rule', 'git.push.force', '--session', 'sess-old', '--format', 'json'],
      root
    );
    assert.equal(json.status, 0, json.stderr);
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].rule_id, 'git.push.force');
  });
});

describe('audit gc (T3.3)', () => {
  it('drops entries older than --older-than', (t) => {
    const root = tmpRepoWithLog(SAMPLE);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const result = gcAudit(root, { olderThan: '30d', now: NOW });
    assert.equal(result.removed, 0);
    assert.equal(result.kept, 3);

    const oldNow = new Date('2026-10-20T12:00:00.000Z');
    const gc = gcAudit(root, { olderThan: '30d', now: oldNow });
    assert.equal(gc.removed, 3);
    assert.equal(gc.kept, 0);

    const leftover = fs.readFileSync(path.join(root, '.agent-governor/audit.log'), 'utf8').trim();
    assert.equal(leftover, '');
  });

  it('runs from the CLI as audit gc --older-than 30d', (t) => {
    const root = tmpRepoWithLog([
      {
        ts: '2026-08-01T00:00:00.000Z',
        session: 'gone',
        decision: 'deny',
        rule_id: 'git.push.force',
      },
      {
        ts: new Date().toISOString(),
        session: 'keep',
        decision: 'allow',
        rule_id: null,
      },
    ]);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const proc = runGovernor(['audit', 'gc', '--older-than', '30d'], root);
    assert.equal(proc.status, 0, proc.stderr);
    assert.match(proc.stdout + proc.stderr, /removed 1/);
    assert.match(proc.stdout + proc.stderr, /kept 1/);

    const lines = fs
      .readFileSync(path.join(root, '.agent-governor/audit.log'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].session, 'keep');
  });
});
