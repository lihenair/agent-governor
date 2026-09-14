import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildReport, formatReport } from '../src/report.js';

function tmpRepoWithLog(t, lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-report-'));
  const logDir = path.join(dir, '.agent-governor');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(
    path.join(logDir, 'audit.log'),
    lines.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('report: aggregates blocks and rule distribution', (t) => {
  const repo = tmpRepoWithLog(t, [
    { ts: '2026-09-15T10:00:00Z', hook: 'PreToolUse', decision: 'block', rule_id: 'protected-file', input_preview: 'tsconfig.json edit' },
    { ts: '2026-09-15T10:01:00Z', hook: 'PreToolUse', decision: 'allow', rule_id: null, input_preview: 'src/app.js edit' },
    { ts: '2026-09-15T10:02:00Z', hook: 'PreToolUse', decision: 'block', rule_id: 'protected-file', input_preview: 'package.json edit' },
    { ts: '2026-09-15T10:03:00Z', hook: 'PostToolUse', decision: 'block', rule_id: 'noDirectEval', input_preview: 'eval() in app.js' },
    'malformed line skipped silently',
  ]);

  const report = buildReport(repo);
  assert.equal(report.scannedEntries, 5); // 4 JSON records + 1 plain-text line
  assert.equal(report.totalDecisions, 4);
  assert.equal(report.totalBlocks, 3);
  assert.equal(report.byRule['protected-file'], 2);
  assert.equal(report.byRule['noDirectEval'], 1);
  assert.equal(report.byHook.PreToolUse, 3);
  assert.equal(report.byHook.PostToolUse, 1);
  assert.ok(report.blockRate > 0.7 && report.blockRate <= 1);
  assert.equal(report.lastBlock.ruleId, 'noDirectEval');
  assert.match(report.lastBlock.summary, /eval\(\) in app\.js/);
});

test('report: empty log renders a clean report without throwing', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-report-empty-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const report = buildReport(dir);
  assert.equal(report.totalBlocks, 0);
  assert.equal(report.lastBlock, null);

  const text = formatReport(report);
  assert.match(text, /total blocks : 0/);
  assert.match(text, /nothing blocked yet/);
});

test('report: formatReport is human-readable with rules and last block', (t) => {
  const repo = tmpRepoWithLog(t, [
    { ts: new Date().toISOString(), hook: 'PreToolUse', decision: 'block', rule_id: 'git.push.force', input_preview: 'git push --force origin main' },
  ]);
  const text = formatReport(buildReport(repo));
  assert.match(text, /Audit Report/);
  assert.match(text, /git\.push\.force\s+×1/);
  assert.match(text, /last block:/);
  assert.match(text, /git push --force origin main/);
});

test('report: json output is stable and machine-parseable', (t) => {
  const repo = tmpRepoWithLog(t, [
    { ts: '2026-09-15T10:00:00Z', hook: 'PreToolUse', decision: 'block', rule_id: 'forbidden-bash', input_preview: 'x' },
  ]);
  const report = buildReport(repo);
  const json = JSON.parse(JSON.stringify(report));
  assert.equal(json.totalBlocks, 1);
  assert.ok(json.generatedAt);
});
