#!/usr/bin/env node

import path from 'node:path';
import {
  CONFIG,
  extractFilePaths,
  isWriteTool,
  loadConfig,
  resolveProjectRoot,
} from './config.js';
import { extractWriteSnippets } from './inspect.js';
import { logGuardDecision } from './audit/logger.js';
import { ensureSelfProtect, mergeProtectResult } from './self-protect.js';
import { evaluate } from './policy/engine.js';
import { compilePreToolPolicy } from './policy/rules.js';
import { emitBlock, exitAllow, exitBlock, readStdin } from './stdin.js';

export function evaluatePreToolUse(payload, config = CONFIG, projectRoot = process.cwd()) {
  if (!payload || !payload.tool_name) {
    return { exitCode: 0, action: 'allow', ruleId: null };
  }

  const toolInput = payload.tool_input || {};
  const ctx = {
    toolName: payload.tool_name,
    toolInput,
    projectRoot,
    filePaths: extractFilePaths(payload.tool_name, toolInput),
    command: toolInput.command || '',
    snippets: isWriteTool(payload.tool_name) ? extractWriteSnippets(toolInput) : [],
  };

  const decision = evaluate(ctx, compilePreToolPolicy(config));
  if (decision.action === 'allow') {
    return { exitCode: 0, action: 'allow', ruleId: decision.ruleId, reason: decision.reason };
  }

  return {
    exitCode: 2,
    stderr: decision.reason,
    action: decision.action,
    ruleId: decision.ruleId,
    reason: decision.reason,
  };
}

export async function runPreToolUseGuard({
  stdin = process.stdin,
  load = loadConfig,
} = {}) {
  const payload = await readStdin(stdin);
  const projectRoot = resolveProjectRoot(payload);
  const config = await load(projectRoot);
  const started = Date.now();
  const protect = ensureSelfProtect(projectRoot, { failureMode: config.failureMode });

  let result;
  if (!payload || !payload.tool_name) {
    result = mergeProtectResult(protect, { exitCode: 0 });
  } else {
    result = mergeProtectResult(protect, evaluatePreToolUse(payload, config, projectRoot));
  }

  logGuardDecision(payload, result, {
    repoRoot: projectRoot,
    hook: 'PreToolUse',
    duration_ms: Date.now() - started,
    failure_mode: config.failureMode || 'open',
  });
  return result;
}

async function main() {
  try {
    const result = await runPreToolUseGuard();
    if (result.stderr) {
      emitBlock(result.stderr);
    }
    if (result.exitCode === 2) {
      exitBlock();
    }
    exitAllow();
  } catch (err) {
    emitBlock(`[Agent Governor Error]: ${err.message}`);
    exitAllow();
  }
}

const entry = process.argv[1] ? path.normalize(process.argv[1]) : '';
if (entry.endsWith(`${path.sep}pre-tool-use.js`)) {
  void main();
}
