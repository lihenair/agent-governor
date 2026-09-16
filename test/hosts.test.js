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
  tool_name: 'run_shell_command',
  tool_input: { command: 'git push --force origin main' },
  cwd: '/repo',
  session_id: 'abc',
  timestamp: '2026-09-15T00:00:00Z',
};

const CURSOR_BEFORShell = {
  hook_event_name: 'beforeShellExecution',
  command: 'git push --force origin main',
  conversationId: 'c1',
  generationId: 'g1',
};

const CURSOR_BEFOREREAD = {
  hook_event_name: 'beforeReadFile',
  file_path: '/repo/.env',
  content: 'SECRET=1',
};

const WINDSURF_PRERUN = {
  agent_action_name: 'pre_run_command',
  tool_info: { command_line: 'git push --force origin main', cwd: '/repo' },
};

const WINDSURF_PREWRITE = {
  agent_action_name: 'pre_write_code',
  tool_info: {
    file_path: '/repo/a.rs',
    edits: [{ old_string: 'a', new_string: 'unsafe { x(); }' }],
  },
};

const OPENCODE_SHIM = {
  host: 'opencode',
  tool: 'bash',
  args: { command: 'git push --force origin main' },
};

test('hosts: registry covers all mainstream agents', () => {
  assert.deepEqual(
    [...HOSTS].sort(),
    ['claude-code', 'codex', 'cursor', 'gemini-cli', 'opencode', 'windsurf'].sort()
  );
});

test('hosts: detect cursor by before*/after* event names', () => {
  assert.equal(detectHost(CURSOR_BEFORShell), 'cursor');
  assert.equal(detectHost(CURSOR_BEFOREREAD), 'cursor');
});

test('hosts: detect windsurf by agent_action_name + tool_info', () => {
  assert.equal(detectHost(WINDSURF_PRERUN), 'windsurf');
  assert.equal(detectHost(WINDSURF_PREWRITE), 'windsurf');
});

test('hosts: detect opencode shim payloads', () => {
  assert.equal(detectHost(OPENCODE_SHIM), 'opencode');
});

test('hosts: cursor shell normalizes to Bash PreToolUse', () => {
  const { payload, host } = normalizeInput(CURSOR_BEFORShell);
  assert.equal(host, 'cursor');
  assert.equal(payload.hook_event_name, 'PreToolUse');
  assert.equal(payload.tool_name, 'Bash');
  assert.equal(payload.tool_input.command, 'git push --force origin main');
});

test('hosts: cursor beforeReadFile normalizes to Read', () => {
  const { payload } = normalizeInput(CURSOR_BEFOREREAD);
  assert.equal(payload.hook_event_name, 'PreToolUse');
  assert.equal(payload.tool_name, 'Read');
  assert.equal(payload.tool_input.file_path, '/repo/.env');
});

test('hosts: windsurf pre_run_command normalizes to Bash PreToolUse', () => {
  const { payload, host } = normalizeInput(WINDSURF_PRERUN);
  assert.equal(host, 'windsurf');
  assert.equal(payload.hook_event_name, 'PreToolUse');
  assert.equal(payload.tool_name, 'Bash');
  assert.equal(payload.tool_input.command, 'git push --force origin main');
});

test('hosts: windsurf pre_write_code carries edit content', () => {
  const { payload } = normalizeInput(WINDSURF_PREWRITE);
  assert.equal(payload.hook_event_name, 'PreToolUse');
  assert.equal(payload.tool_name, 'Write');
  assert.equal(payload.tool_input.file_path, '/repo/a.rs');
  assert.match(payload.tool_input.content, /unsafe/);
});

test('hosts: opencode shim normalizes tool+args', () => {
  const { payload, host } = normalizeInput(OPENCODE_SHIM);
  assert.equal(host, 'opencode');
  assert.equal(payload.hook_event_name, 'PreToolUse');
  assert.equal(payload.tool_name, 'bash');
});

test('hosts: cursor deny output uses permission field (exit 0)', () => {
  const out = formatOutput(
    { exitCode: 2, reason: 'force push blocked' },
    { host: 'cursor', event: 'beforeShellExecution' }
  );
  assert.equal(out.exitCode, 0);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.permission, 'deny');
  assert.match(parsed.agentMessage, /force push/);
});

test('hosts: cursor allow output', () => {
  const out = formatOutput({ exitCode: 0 }, { host: 'cursor', event: 'beforeShellExecution' });
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.permission, 'allow');
});

test('hosts: windsurf uses exit-code contract (2=block)', () => {
  const blocked = formatOutput(
    { exitCode: 2, reason: 'unsafe' },
    { host: 'windsurf', event: 'pre_run_command' }
  );
  assert.equal(blocked.exitCode, 2);
  assert.match(blocked.stderr, /unsafe/);

  const allowed = formatOutput({ exitCode: 0 }, { host: 'windsurf', event: 'pre_run_command' });
  assert.equal(allowed.exitCode, 0);
});

test('hosts: opencode uses exit-code contract (2=block, thrown by plugin)', () => {
  const blocked = formatOutput(
    { exitCode: 2, reason: 'deny: config tamper' },
    { host: 'opencode', event: 'PreToolUse' }
  );
  assert.equal(blocked.exitCode, 2);
  assert.match(blocked.stderr, /deny/);
});

test('hosts: prior codex/gemini behaviors unchanged (regression)', () => {
  const codex = formatOutput(
    { exitCode: 2, reason: 'x' },
    { host: 'codex', event: 'PreToolUse' }
  );
  const codexParsed = JSON.parse(codex.stdout);
  assert.equal(codexParsed.decision, 'block');

  const gem = formatOutput({ exitCode: 2, reason: 'y' }, { host: 'gemini-cli', event: 'BeforeTool' });
  const gemParsed = JSON.parse(gem.stdout);
  assert.equal(gemParsed.decision, 'deny');

  const cc = formatOutput({ exitCode: 2, reason: 'z' }, { host: 'claude-code' });
  assert.equal(cc.exitCode, 2);
});

test('hosts: end-to-end cursor deny through the guard runner', async () => {
  const { runHookGuard } = await import('../src/dispatch.js');
  const { Readable } = await import('node:stream');
  const stream = Readable.from([JSON.stringify(CURSOR_BEFORShell)]);
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
  const out = formatOutput(result, { host: 'cursor', event: 'beforeShellExecution' });
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.permission, 'deny');
});
