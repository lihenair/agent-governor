import { loadConfig, resolveProjectRoot } from './config.js';
import { evaluatePostToolUse } from './post-tool-use.js';
import { evaluatePreToolUse } from './pre-tool-use.js';
import { logGuardDecision } from './audit/logger.js';
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
  const started = Date.now();
  const protect = ensureSelfProtect(projectRoot, { failureMode: config.failureMode });

  let result;
  if (!payload || !payload.tool_name) {
    result = mergeProtectResult(protect, { exitCode: 0 });
  } else {
    result = mergeProtectResult(protect, await evaluateHook(payload, config, projectRoot, io));
  }

  const event = payload?.hook_event_name || payload?.hookEventName || '';
  logGuardDecision(payload, result, {
    repoRoot: projectRoot,
    hook: event === 'PostToolUse' ? 'PostToolUse' : 'PreToolUse',
    duration_ms: Date.now() - started,
    failure_mode: config.failureMode || 'open',
  });
  return result;
}
