#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import { CONFIG, extractFilePaths, isWriteTool, loadConfig, resolveProjectRoot } from './config.js';
import { emitBlock, exitAllow, exitBlock, readStdin } from './stdin.js';

const defaultTraverse = traverse.default || traverse;

const PARSER_PLUGINS = [
  'typescript',
  'jsx',
  'classProperties',
  'classPrivateProperties',
  'classPrivateMethods',
  'decorators-legacy',
  'importAssertions',
  'topLevelAwait',
];

function hasJsx(ast) {
  let found = false;
  defaultTraverse(ast, {
    JSXElement() {
      found = true;
    },
    JSXFragment() {
      found = true;
    },
  });
  return found;
}

export function inspectAST(filePath, code, config = CONFIG) {
  const errors = [];
  const ext = path.extname(filePath);

  if (!config.codeExtensions.includes(ext)) {
    return errors;
  }

  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: 'unambiguous',
      allowReturnOutsideFunction: true,
      plugins: PARSER_PLUGINS,
    });
  } catch (parseError) {
    errors.push(`Syntax Error in generated code: ${parseError.message}`);
    return errors;
  }

  const astRules = config.astRules || {};

  defaultTraverse(ast, {
    CallExpression(pathNode) {
      const callee = pathNode.node.callee;
      const line = pathNode.node.loc?.start.line ?? '?';

      if (
        astRules.noDirectEval !== false &&
        callee.type === 'Identifier' &&
        callee.name === 'eval'
      ) {
        errors.push(`Line ${line}: Direct 'eval()' usage is strictly forbidden.`);
      }

      if (Array.isArray(astRules.forbiddenCallNames)) {
        if (callee.type === 'Identifier' && astRules.forbiddenCallNames.includes(callee.name)) {
          errors.push(`Line ${line}: Call to forbidden function '${callee.name}()' is not allowed.`);
        }
      }
    },

    NewExpression(pathNode) {
      const callee = pathNode.node.callee;
      const line = pathNode.node.loc?.start.line ?? '?';
      if (
        astRules.noNewFunction &&
        callee.type === 'Identifier' &&
        callee.name === 'Function'
      ) {
        errors.push(`Line ${line}: 'new Function()' is a dynamic eval equivalent and is forbidden.`);
      }
    },

    Identifier(pathNode) {
      const names = astRules.forbiddenIdentifiers;
      if (!Array.isArray(names) || names.length === 0) {
        return;
      }
      if (names.includes(pathNode.node.name) && pathNode.isReferencedIdentifier()) {
        const line = pathNode.node.loc?.start.line ?? '?';
        errors.push(`Line ${line}: Identifier '${pathNode.node.name}' is forbidden by project policy.`);
      }
    },
  });

  if (astRules.requireErrorBoundary && ['.jsx', '.tsx'].includes(ext) && hasJsx(ast)) {
    const looksLikeAppShell = /(^|\/)(App|Root|main|index)\.(jsx|tsx)$/i.test(
      filePath.split(path.sep).join('/')
    );
    if (looksLikeAppShell && !/\bErrorBoundary\b/.test(code)) {
      errors.push(
        `React app shell "${path.basename(filePath)}" must include an ErrorBoundary to satisfy architecture SOP.`
      );
    }
  }

  return errors;
}

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
    const astErrors = inspectAST(filePath, code, config);
    if (astErrors.length > 0) {
      allErrors.push(
        `Post-execution AST Validation Errors in "${filePath}":\n` +
          astErrors.map((entry) => ` - ${entry}`).join('\n')
      );
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
  if (!payload || !payload.tool_name) {
    return { exitCode: 0 };
  }

  const projectRoot = resolveProjectRoot(payload);
  const config = await load(projectRoot);
  return evaluatePostToolUse(payload, config, io);
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
