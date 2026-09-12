#!/usr/bin/env node

import path from 'node:path';
import {
  CONFIG,
  extractFilePaths,
  isProtectedDirectory,
  isProtectedFileName,
  isWriteTool,
  loadConfig,
  resolveProjectRoot,
} from './config.js';
import { emitBlock, exitAllow, exitBlock, readStdin } from './stdin.js';

function blockMessage(body) {
  return `[Agent Governor Security Alert] 🛑 GOVERNOR BLOCK: ${body}`;
}

export function evaluatePreToolUse(payload, config = CONFIG, projectRoot = process.cwd()) {
  if (!payload || !payload.tool_name) {
    return { exitCode: 0 };
  }

  const { tool_name: toolName, tool_input: toolInput = {} } = payload;

  if (isWriteTool(toolName)) {
    const targetPaths = extractFilePaths(toolName, toolInput);

    for (const targetFilePath of targetPaths) {
      const fileName = path.basename(targetFilePath);

      if (isProtectedFileName(fileName, config)) {
        return {
          exitCode: 2,
          stderr: blockMessage(
            `You are prohibited from editing protected configuration file "${fileName}".\n` +
              `Fix the underlying source code issues instead of tampering with build/lint/typecheck configurations.`
          ),
        };
      }

      if (isProtectedDirectory(targetFilePath, config, projectRoot)) {
        return {
          exitCode: 2,
          stderr: blockMessage(
            `Access denied to path "${targetFilePath}". Modification of agent governance infrastructure is forbidden.`
          ),
        };
      }
    }
  }

  if (toolName === 'Bash') {
    const command = toolInput?.command || '';

    for (const pattern of config.forbiddenBashPatterns || []) {
      if (pattern.test(command)) {
        return {
          exitCode: 2,
          stderr: blockMessage(
            `The bash command "${command}" violates repository safety rules.`
          ),
        };
      }
    }

    const writeLike =
      /(^|[\s;&|])(?:tee|sed\s+-i|perl\s+-pi|ruby\s+-pi)|(?:^|[\s])(?:>{1,2}|cat\s*>)/i;
    if (writeLike.test(command)) {
      for (const fileName of config.protectedFiles || []) {
        const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const filePattern = new RegExp(`(?:^|[\\s/"'])${escaped}(?:$|[\\s"'&|;])`);
        if (filePattern.test(command)) {
          return {
            exitCode: 2,
            stderr: blockMessage(
              `You are prohibited from editing protected configuration file "${fileName}" via Bash.\n` +
                `Fix the underlying source code issues instead of tampering with build/lint/typecheck configurations.`
            ),
          };
        }
      }
    }
  }

  return { exitCode: 0 };
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
