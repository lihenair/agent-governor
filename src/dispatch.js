import { loadConfig, resolveProjectRoot } from './config.js';
import { evaluatePostToolUse } from './post-tool-use.js';
import { evaluatePreToolUse } from './pre-tool-use.js';
import { ensureSelfProtect, mergeProtectResult } from './self-protect.js';
import { readStdin } from './stdin.js';

export async function evaluateHook(payload, config, projectRoot, io) {
  const event = payload?.hook_event_name || payload?.hookEventName || '';
  if (event === 'PostToolUse') {
    return evaluatePostToolUse(payload, config, io);
  }
  return evaluatePreToolUse(payload, config, projectRoot);
}

export async function runHookGuard({ stdin = process.stdin, load = loadConfig, io } = {}) {
  const payload = await readStdin(stdin);
  const projectRoot = resolveProjectRoot(payload);
  const config = await load(projectRoot);
  const protect = ensureSelfProtect(projectRoot, { failureMode: config.failureMode });

  if (!payload || !payload.tool_name) {
    return mergeProtectResult(protect, { exitCode: 0 });
  }

  return mergeProtectResult(protect, await evaluateHook(payload, config, projectRoot, io));
}
