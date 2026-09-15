import { loadConfig, resolveProjectRoot } from './config.js';
import { evaluatePostToolUse } from './post-tool-use.js';
import { evaluatePreToolUse } from './pre-tool-use.js';
import { evaluateReadScan } from './read-guard.js';
import { logGuardDecision } from './audit/logger.js';
import { ensureSelfProtect, mergeProtectResult } from './self-protect.js';
import { readStdin } from './stdin.js';

export async function evaluateHook(payload, config, projectRoot, io) {
  const event = payload?.hook_event_name || payload?.hookEventName || '';
  if (event === 'PostToolUse') {
    const result = evaluatePostToolUse(payload, config, io);
    if (result.exitCode === 0) {
      // Read-side injection scan: PostToolUse on Read/WebFetch/etc.
      const readScan = evaluateReadScan(payload, config, io);
      if (readScan.exitCode === 2) {
        return readScan;
      }
    }
    return result;
  }
  return evaluatePreToolUse(payload, config, projectRoot);
}

export async function runHookGuard({ stdin = process.stdin, load = loadConfig, io, payloadOverride } = {}) {
  const payload = payloadOverride !== undefined ? payloadOverride : await readStdin(stdin);
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
