import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { formatDoctorReport, runDoctor } from '../src/doctor.js';

function tmpRepo(t, { withSettings = false, settingsContent = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-doctor-'));
  if (withSettings) {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude', 'settings.json'),
      settingsContent ?? JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'npx agent-governor pre-check' }] }],
        },
      })
    );
  }
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('doctor: healthy bare repo passes all critical checks', async (t) => {
  const repo = tmpRepo(t);
  const report = await runDoctor(repo);
  assert.equal(report.ok, true, JSON.stringify(report.checks.filter((c) => !c.ok)));
  const ids = report.checks.map((c) => c.id);
  for (const expected of ['node-version', 'package-files', 'config', 'hooks-installed', 'audit-writable', 'deny-works']) {
    assert.ok(ids.includes(expected), `missing check: ${expected}`);
  }
});

test('doctor: deny-works check proves the engine blocks force-push', async (t) => {
  const repo = tmpRepo(t);
  const report = await runDoctor(repo);
  const deny = report.checks.find((c) => c.id === 'deny-works');
  assert.equal(deny.ok, true);
  assert.match(deny.detail, /blocked/);
});

test('doctor: hooks-installed passes when settings reference the governor', async (t) => {
  const repo = tmpRepo(t, { withSettings: true });
  const report = await runDoctor(repo);
  const hooks = report.checks.find((c) => c.id === 'hooks-installed');
  assert.equal(hooks.ok, true);
  assert.match(hooks.detail, /PreToolUse/);
});

test('doctor: hooks-installed is soft-pass with fix hint when no settings exist', async (t) => {
  const repo = tmpRepo(t);
  const report = await runDoctor(repo);
  const hooks = report.checks.find((c) => c.id === 'hooks-installed');
  assert.equal(hooks.ok, true);
  assert.equal(hooks.warn, true);
  assert.match(hooks.fix, /agent-governor init/);
});

test('doctor: broken config json fails the config check with a fix', async (t) => {
  const repo = tmpRepo(t);
  fs.writeFileSync(path.join(repo, 'governor.config.json'), '{ not json !!!');
  const report = await runDoctor(repo);
  assert.equal(report.ok, false);
  const config = report.checks.find((c) => c.id === 'config');
  assert.equal(config.ok, false);
  assert.match(config.fix, /JSON/);
});

test('doctor: unknown preset in config fails with available names', async (t) => {
  const repo = tmpRepo(t);
  fs.writeFileSync(path.join(repo, 'governor.config.json'), JSON.stringify({ preset: 'yolo' }));
  const report = await runDoctor(repo);
  const config = report.checks.find((c) => c.id === 'config');
  assert.equal(config.ok, false);
  assert.match(config.fix, /security-hard/);
});

test('doctor: reports ast-grep install hint when engine is ast-grep', async (t) => {
  const repo = tmpRepo(t);
  fs.writeFileSync(path.join(repo, 'governor.config.json'), JSON.stringify({ engine: 'ast-grep' }));
  const report = await runDoctor(repo);
  const grep = report.checks.find((c) => c.id === 'ast-grep');
  assert.ok(grep, 'missing ast-grep check');
  assert.equal(grep.ok, true);
  assert.match(grep.detail, /napi/);
});

test('doctor: report format is readable with icons and fixes', async (t) => {
  const repo = tmpRepo(t);
  const report = await runDoctor(repo);
  const text = formatDoctorReport(report);
  assert.match(text, /Agent Governor Doctor/);
  assert.match(text, /✔ node-version/);
  assert.match(text, /✔ deny-works/);
});
