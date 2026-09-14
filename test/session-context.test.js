import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildSessionContext,
  runSessionHook,
  summarizeRecentBlocks,
  SESSION_HOOK_EVENTS,
} from '../src/session-context.js';
import { hookSettingsFor, mergeHookSettings } from '../src/init.js';

function tmpRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-session-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('session-context: SessionStart and PreCompact are the supported events', () => {
  assert.ok(SESSION_HOOK_EVENTS.has('SessionStart'));
  assert.ok(SESSION_HOOK_EVENTS.has('PreCompact'));
});

test('session-context: emits exit 0 with non-empty context text', async () => {
  const result = await buildSessionContext({ event: 'SessionStart' });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /\[Agent Governor active — SessionStart re-injection\]/);
  assert.match(result.stdout, /Policy rules compiled: \d+/);
  assert.match(result.stdout, /Protected files: \d+/);
  assert.match(result.stdout, /Recent blocks this repo: 0/);
});

test('session-context: PreCompact event is reflected in the banner', async () => {
  const result = await buildSessionContext({ event: 'PreCompact' });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /PreCompact re-injection/);
});

test('session-context: summarizes recent blocks from audit log', (t) => {
  const repo = tmpRepo(t);
  const logDir = path.join(repo, '.agent-governor');
  fs.mkdirSync(logDir, { recursive: true });
  const lines = [
    JSON.stringify({ timestamp: '2026-09-15T10:00:00Z', decision: 'block', ruleId: 'protected-file' }),
    JSON.stringify({ timestamp: '2026-09-15T10:05:00Z', decision: 'allow' }),
    JSON.stringify({ timestamp: '2026-09-15T10:10:00Z', decision: 'block', ruleId: 'git.push.force' }),
    'not json',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(logDir, 'audit.log'), lines);

  const stats = summarizeRecentBlocks(repo);
  assert.equal(stats.total, 2);
  assert.equal(stats.byRule['protected-file'], 1);
  assert.equal(stats.byRule['git.push.force'], 1);
});

test('session-context: includes block stats when provided or found', async (t) => {
  const repo = tmpRepo(t);
  const logDir = path.join(repo, '.agent-governor');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(
    path.join(logDir, 'audit.log'),
    `${JSON.stringify({ decision: 'block', ruleId: 'forbidden-bash' })}\n`
  );

  const result = await buildSessionContext({ event: 'PreCompact', projectRoot: repo });
  assert.match(result.stdout, /Recent blocks this repo: 1/);
  assert.match(result.stdout, /forbidden-bash×1/);
});

test('session-context: hard budget keeps stdout under maxChars', async () => {
  const result = await buildSessionContext({ maxChars: 120 });
  assert.ok(result.stdout.length <= 120, `stdout too long: ${result.stdout.length}`);
  assert.ok(result.stdout.endsWith('…'));
});

test('session-context: never throws on broken repo state', async (t) => {
  const repo = tmpRepo(t);
  const logDir = path.join(repo, '.agent-governor');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, 'audit.log'), 'gibberish');
  const result = await runSessionHook({ event: 'SessionStart', projectRoot: repo });
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.length > 0);
});

test('init: hookSettingsFor injects SessionStart, PreCompact and read-scan hooks', () => {
  const settings = hookSettingsFor(['node']);
  assert.ok(settings.SessionStart, 'SessionStart missing');
  assert.ok(settings.PreCompact, 'PreCompact missing');
  assert.match(settings.SessionStart[0].hooks[0].command, /session-hook --event SessionStart/);
  assert.match(settings.PreCompact[0].hooks[0].command, /session-hook --event PreCompact/);

  const postCommands = settings.PostToolUse.map((group) => group.hooks[0].command);
  assert.ok(postCommands.includes('npx agent-governor post-check'));
  const readMatcher = settings.PostToolUse.find((group) => group.matcher === 'Read|WebFetch|WebSearch');
  assert.ok(readMatcher, 'read-side matcher missing');
});

test('init: mergeHookSettings adds session hooks to existing settings once', () => {
  const existing = {
    hooks: {
      PreToolUse: [],
      PostToolUse: [],
    },
  };
  const once = mergeHookSettings(existing, ['node']);
  const twice = mergeHookSettings(once, ['node']);
  assert.equal(twice.hooks.SessionStart.length, once.hooks.SessionStart.length);
  assert.equal(twice.hooks.PreCompact.length, once.hooks.PreCompact.length);
  assert.equal(twice.hooks.SessionStart.length, 1);
});
