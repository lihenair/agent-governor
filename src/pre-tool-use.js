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
import { evaluate } from './policy/engine.js';
import { compilePreToolPolicy } from './policy/rules.js';
import { emitBlock, exitAllow, exitBlock, readStdin } from './stdin.js';

export function evaluatePreToolUse(payload, config = CONFIG, projectRoot = process.cwd()) {
  if (!payload || !payload.tool_name) {
    return { exitCode: 0, action: 'allow', ruleId: null };
  }

  const toolInput = payload.tool_input || {};
  const command = toolInput.command || '';
  const parsed = payload.tool_name === 'Bash' ? parseBash(command) : [];
  const ctx = {
    toolName: payload.tool_name,
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
} = {}) {
  const payload = await readStdin(stdin);
  if (!payload || !payload.tool_name) {
    return { exitCode: 0 };
  }

  const projectRoot = resolveProjectRoot(payload);
  const config = await load(projectRoot);
  return evaluatePreToolUse(payload, config, projectRoot);
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
