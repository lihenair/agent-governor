#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, extractFilePaths, isWriteTool, loadConfig, resolveProjectRoot } from './config.js';
import { formatInspectBlock, inspectAST, inspectSource } from './inspect.js';
import { logGuardDecision } from './audit/logger.js';
import { ensureSelfProtect, mergeProtectResult } from './self-protect.js';
import { emitBlock, exitAllow, exitBlock, readStdin } from './stdin.js';

export { inspectAST };

export function evaluatePostToolUse(
  payload,
  config = CONFIG,
  { readFileSync = fs.readFileSync, existsSync = fs.existsSync } = {}
) {
  if (!payload || !payload.tool_name) {
    return { exitCode: 0 };
  }

  const { tool_name: toolName, tool_input: toolInput = {} } = payload;
  if (!isWriteTool(toolName)) {
    return { exitCode: 0 };
  }

  const filePaths = extractFilePaths(toolName, toolInput);
  const allErrors = [];

  for (const filePath of filePaths) {
    if (!filePath || !existsSync(filePath)) {
      continue;
    }
    const code = readFileSync(filePath, 'utf8');
    const astErrors = inspectSource(filePath, code, config);
    if (astErrors.length > 0) {
      allErrors.push(formatInspectBlock(filePath, astErrors));
    }
  }

  if (allErrors.length > 0) {
    return {
      exitCode: 2,
      stderr:
        `[Agent Governor AST Check Failed] ❌ ${allErrors.join('\n\n')}\n\n` +
        `Please revert or fix these violations immediately to maintain architecture compliance.`,
    };
  }

  return { exitCode: 0 };
}

export async function runPostToolUseGuard({
  stdin = process.stdin,
  load = loadConfig,
  io,
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
    result = mergeProtectResult(protect, evaluatePostToolUse(payload, config, io));
  }

  logGuardDecision(payload, result, {
    repoRoot: projectRoot,
    hook: 'PostToolUse',
    duration_ms: Date.now() - started,
    failure_mode: config.failureMode || 'open',
  });
  return result;
}

async function main() {
  try {
    const result = await runPostToolUseGuard();
    if (result.stderr) {
      emitBlock(result.stderr);
    }
    if (result.exitCode === 2) {
      exitBlock();
    }
    exitAllow();
  } catch (err) {
    emitBlock(`[Agent Governor Post-Hook Error]: ${err.message}`);
    exitAllow();
  }
}

const entry = process.argv[1] ? path.normalize(process.argv[1]) : '';
if (entry.endsWith(`${path.sep}post-tool-use.js`)) {
  void main();
}
