import path from 'node:path';
import {
  isProtectedDirectory,
  isProtectedFileName,
  isWriteTool,
} from '../config.js';
import { formatInspectBlock, inspectSource } from '../inspect.js';

function blockMessage(body) {
  return `[Agent Governor Security Alert] 🛑 GOVERNOR BLOCK: ${body}`;
}

function firstProtectedFileName(filePaths, config) {
  for (const target of filePaths || []) {
    const fileName = path.basename(target);
    if (isProtectedFileName(fileName, config)) {
      return fileName;
    }
  }
  return null;
}

function firstProtectedPath(filePaths, config, projectRoot) {
  for (const target of filePaths || []) {
    if (isProtectedDirectory(target, config, projectRoot)) {
      return target;
    }
  }
  return null;
}

function firstSourceViolation(snippets, config) {
  for (const { filePath, code } of snippets || []) {
    const errors = inspectSource(filePath, code, config);
    if (errors.length > 0) {
      return { filePath, errors };
    }
  }
  return null;
}

function matchingBashPattern(command, config) {
  for (const pattern of config.forbiddenBashPatterns || []) {
    if (pattern.test(command || '')) {
      return pattern;
    }
  }
  return null;
}

function protectedFileViaBash(command, config) {
  const writeLike =
    /(^|[\s;&|])(?:tee|sed\s+-i|perl\s+-pi|ruby\s+-pi)|(?:^|[\s])(?:>{1,2}|cat\s*>)/i;
  if (!writeLike.test(command || '')) {
    return null;
  }

  for (const fileName of config.protectedFiles || []) {
    const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filePattern = new RegExp(`(?:^|[\\s/"'])${escaped}(?:$|[\\s"'&|;])`);
    if (filePattern.test(command)) {
      return fileName;
    }
  }
  return null;
}

/**
 * Compile the current governor config into an ordered rule list.
 * Behavior matches the previous hardcoded evaluatePreToolUse chain.
 *
 * @param {import('../index.js').GovernorConfig} config
 * @returns {import('./schema.js').Policy}
 */
export function compilePreToolPolicy(config) {
  return {
    defaultAction: 'allow',
    rules: [
      {
        id: 'protected-file',
        action: 'deny',
        match(ctx) {
          return isWriteTool(ctx.toolName) && Boolean(firstProtectedFileName(ctx.filePaths, config));
        },
        reason(ctx) {
          const fileName = firstProtectedFileName(ctx.filePaths, config);
          return blockMessage(
            `You are prohibited from editing protected configuration file "${fileName}".\n` +
              `Fix the underlying source code issues instead of tampering with build/lint/typecheck configurations.`
          );
        },
      },
      {
        id: 'protected-directory',
        action: 'deny',
        match(ctx) {
          return (
            isWriteTool(ctx.toolName) &&
            Boolean(firstProtectedPath(ctx.filePaths, config, ctx.projectRoot))
          );
        },
        reason(ctx) {
          const targetFilePath = firstProtectedPath(ctx.filePaths, config, ctx.projectRoot);
          return blockMessage(
            `Access denied to path "${targetFilePath}". Modification of agent governance infrastructure is forbidden.`
          );
        },
      },
      {
        id: 'source-policy',
        action: 'deny',
        match(ctx) {
          return isWriteTool(ctx.toolName) && Boolean(firstSourceViolation(ctx.snippets, config));
        },
        reason(ctx) {
          const hit = firstSourceViolation(ctx.snippets, config);
          return (
            `[Agent Governor AST Check Failed] ❌ ${formatInspectBlock(hit.filePath, hit.errors)}\n\n` +
            `Fix the source before the tool runs. Do not weaken compiler or linter config.`
          );
        },
      },
      {
        id: 'forbidden-bash',
        action: 'deny',
        match(ctx) {
          return ctx.toolName === 'Bash' && Boolean(matchingBashPattern(ctx.command, config));
        },
        reason(ctx) {
          return blockMessage(
            `The bash command "${ctx.command}" violates repository safety rules.`
          );
        },
      },
      {
        id: 'protected-file-bash',
        action: 'deny',
        match(ctx) {
          return ctx.toolName === 'Bash' && Boolean(protectedFileViaBash(ctx.command, config));
        },
        reason(ctx) {
          const fileName = protectedFileViaBash(ctx.command, config);
          return blockMessage(
            `You are prohibited from editing protected configuration file "${fileName}" via Bash.\n` +
              `Fix the underlying source code issues instead of tampering with build/lint/typecheck configurations.`
          );
        },
      },
    ],
  };
}
