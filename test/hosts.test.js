import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HOSTS,
  detectHost,
  formatOutput,
  isSupportedHost,
  normalizeInput,
} from '../src/hosts.js';

const CODEX_PRETOOLUSE = {
  hook_event_name: 'PreToolUse',
  tool_name: 'shell',
  tool_input: { command: 'git push --force origin main' },
  cwd: '/repo',
  session_id: 'abc',
  tool_use_id: 'tu_1',
  permission_mode: 'default',
};

const GEMINI_BEFORETOOL = {
  hook_event_name: 'BeforeTool',
  tool_name: 'shell',
  tool_input: { command: 'git push --force origin main' },
  cwd: '/repo',
  session_id: 'abc',
  timestamp: '2026-09-15T00:00:00Z',
};

const CLAUDE_PRETOOLUSE = {
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'git push --force origin main' },
  cwd: '/repo',
};

test('hosts: registry is complete', () => {
  assert.deepEqual([...HOSTS].sort(), ['claude-code', 'codex', 'gemini-cli'].sort());
  assert.ok(isSupportedHost('gemini-cli'));
  assert.equal(isSupportedHost('windsurf'), false);
});

test('hosts: detect gemini-cli by BeforeTool event or timestamp', () => {
  assert.equal(detectHost(GEMINI_BEFORETOOL), 'gemini-cli');
  assert.equal(detectHost({ hook_event_name: 'SessionStart', timestamp: 'x' }), 'gemini-cli');
});

test('hosts: detect codex by tool_use_id / permission_mode', () => {
  assert.equal(detectHost(CODEX_PRETOOLUSE), 'codex');
  assert.equal(detectHost({ hook_event_name: 'PostToolUse', tool_use_id: 'x' }), 'codex');
});

test('hosts: claude-code payload stays native', () => {
  assert.equal(detectHost(CLAUDE_PRETOOLUSE), 'claude-code');
  const { payload, host } = normalizeInput(CLAUDE_PRETOOLUSE);
  assert.equal(host, 'claude-code');
  assert.deepEqual(payload, CLAUDE_PRETOOLUSE);
});

test('hosts: gemini BeforeTool normalizes to PreToolUse', () => {
  const { payload, host } = normalizeInput(GEMINI_BEFORETOOL);
  assert.equal(host, 'gemini-cli');
  assert.equal(payload.hook_event_name, 'PreToolUse');
  assert.equal(payload.tool_input.command, 'git push --force origin main');
});

test('hosts: gemini PreCompress normalizes to PreCompact', () => {
  const { payload } = normalizeInput({ hook_event_name: 'PreCompress', timestamp: 'x' });
  assert.equal(payload.hook_event_name, 'PreCompact');
});

test('hosts: codex PreToolUse normalizes to native shape', () => {
  const { payload, host } = normalizeInput(CODEX_PRETOOLUSE);
  assert.equal(host, 'codex');
  assert.equal(payload.hook_event_name, 'PreToolUse');
  assert.equal(payload.tool_name, 'shell');
});

test('hosts: codex deny output follows its JSON contract', () => {
  const out = formatOutput(
    { exitCode: 2, reason: 'force push blocked' },
    { host: 'codex', event: 'PreToolUse' }
  );
  assert.equal(out.exitCode, 0);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.decision, 'block');
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /force push/);
});

test('hosts: codex allow output approves', () => {
  const out = formatOutput({ exitCode: 0 }, { host: 'codex', event: 'PostToolUse' });
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.decision, 'approve');
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PostToolUse');
});

test('hosts: gemini deny output uses decision field, exit 0', () => {
  const out = formatOutput(
    { exitCode: 2, reason: 'injection detected' },
    { host: 'gemini-cli', event: 'BeforeTool' }
  );
  assert.equal(out.exitCode, 0);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.decision, 'deny');
  assert.match(parsed.reason, /injection/);
});

test('hosts: gemini allow can carry a warning via systemMessage', () => {
  const out = formatOutput(
    { exitCode: 0, reason: 'suspicious content noted' },
    { host: 'gemini-cli', event: 'AfterTool' }
  );
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.decision, 'allow');
  assert.match(parsed.systemMessage, /suspicious/);
});

test('hosts: claude-code output stays exit-code based', () => {
  const out = formatOutput(
    { exitCode: 2, reason: 'blocked' },
    { host: 'claude-code', event: 'PreToolUse' }
  );
  assert.equal(out.exitCode, 2);
  assert.equal(out.stdout, undefined);
  assert.equal(out.stderr, 'blocked');
});

test('hosts: end-to-end gemini deny through the guard runner', async (t) => {
  const { runHookGuard } = await import('../src/dispatch.js');
  const { Readable } = await import('node:stream');
  const stream = Readable.from([JSON.stringify(GEMINI_BEFORETOOL)]);
  const result = await runHookGuard({
    stdin: stream,
    load: async () => ({
      astRules: {},
      forbiddenBashPatterns: [],
      protectedFiles: [],
      protectedDirectories: [],
      injectionMode: 'scan',
    }),
  });
  assert.equal(result.exitCode, 2);
  const out = formatOutput(result, { host: 'gemini-cli', event: 'BeforeTool' });
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.decision, 'deny');
});
