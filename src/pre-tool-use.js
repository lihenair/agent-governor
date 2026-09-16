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
import { collectCapabilities, parseBash } from './parser/bash.js';
import { logGuardDecision } from './audit/logger.js';
import { ensureSelfProtect, mergeProtectResult } from './self-protect.js';
import { evaluate } from './policy/engine.js';
import { compilePreToolPolicy } from './policy/rules.js';
import { normalizeInput } from './hosts.js';
import { emitBlock, exitAllow, exitBlock, readStdin } from './stdin.js';

/**
 * Hosts whose shell tool has a different name but the same { command } shape.
 * Codex names it `shell` (plus local shell wrappers); Gemini names it
 * `run_shell_command`. Treat all of them as Bash for parsing purposes.
 */
const BASH_TOOL_NAMES = new Set(['Bash', 'shell', 'bash', 'run_shell_command', 'Shell']);

function isBashLikeTool(toolName) {
  return BASH_TOOL_NAMES.has(toolName);
}

export function evaluatePreToolUse(payload, config = CONFIG, projectRoot = process.cwd()) {
  if (!payload || !payload.tool_name) {
    return { exitCode: 0, action: 'allow', ruleId: null };
  }

  const toolInput = payload.tool_input || {};
  const command = toolInput.command || '';
  const bashLike = isBashLikeTool(payload.tool_name);
  const parsed = bashLike ? parseBash(command) : [];
  const ctx = {
    // Normalize shell-like tools (Codex `shell`, Gemini `run_shell_command`)
    // to `Bash` so rules see one name; keep native write-tool names intact.
    toolName: bashLike ? 'Bash' : payload.tool_name,
    toolInput,
    projectRoot,
    filePaths: extractFilePaths(payload.tool_name, toolInput),
    command,
    snippets: isWriteTool(payload.tool_name) ? extractWriteSnippets(toolInput) : [],
    commands: parsed,
    capabilities: collectCapabilities(parsed),
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
  payloadOverride,
} = {}) {
  const raw = payloadOverride !== undefined ? payloadOverride : await readStdin(stdin);
  const { payload } = normalizeInput(raw);
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
