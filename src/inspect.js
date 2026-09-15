import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import { CONFIG } from './config.js';

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

const JS_EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const CPP_EXTS = new Set(['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh']);
const KOTLIN_EXTS = new Set(['.kt', '.kts']);

function stripCLikeComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function stripHashComments(code) {
  return code.replace(/#.*$/gm, '');
}

function matchLines(code, regex, message) {
  const errors = [];
  const lines = code.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    regex.lastIndex = 0;
    if (regex.test(lines[index])) {
      errors.push(`Line ${index + 1}: ${message}`);
    }
  }
  return errors;
}

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

export function inspectJavaScript(filePath, code, config = CONFIG) {
  const errors = [];
  const ext = path.extname(filePath);
  if (!JS_EXTS.has(ext)) {
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

/** @deprecated use inspectJavaScript */
export const inspectAST = inspectJavaScript;

/**
 * True-Python-AST check via the stdlib `ast` module.
 *
 * Why AST instead of regex (verified against evasion samples):
 *   regex misses  aliased calls (`e = eval; e(x)`),
 *                attribute calls (`getattr(builtins, 'eval')(x)`),
 *                computed names (`globals()['eval'](x)`);
 *   AST catches them structurally by walking Call/Import nodes and
 *   tracking banned-call aliases through assignments.
 *
 * Fallback: on a syntax error (agent wrote a partial snippet), we fall back
 * to line-regex so a broken fragment cannot slip through unscanned.
 *
 * Performance: ~50ms per check, dominated by python3 process startup (~43ms
 * cold start); the AST parse itself is ~0.02ms. Acceptable for PostToolUse;
 * the JS fast-path (Babel) covers PreToolUse latency budgets.
 *
 * @param {string} filePath
 * @param {string} code
 * @param {object} config
 * @returns {string[]} errors
 */
export function inspectPython(filePath, code, config = CONFIG) {
  const rules = config.astRules || {};
  const calls = rules.pythonForbiddenCalls || ['eval', 'exec'];
  const imports = rules.pythonDeprecatedImports || ['imp', 'optparse'];
  const errors = [];

  try {
    // The stdlib ast module ships with Python itself — zero new dependencies.
    const payload = JSON.stringify({ code, calls, imports });
    // Inline python runner keeps the zero-dep promise; see python/ast_check.py.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const script = path.join(here, '..', 'python', 'ast_check.py');
    const out = execSync(`python3 ${JSON.stringify(script)}`, {
      input: payload,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(out);
    for (const issue of parsed.issues || []) {
      errors.push(`Line ${issue.lineno}: ${issue.message}`);
    }
    if (parsed.syntaxError) {
      // Partial snippet: fall back to regex so it is still scanned.
      errors.push(...pythonRegexFallback(filePath, code, calls, imports));
    }
    return errors;
  } catch (err) {
    // python3 missing or runner failed: regex fallback keeps protection on.
    return pythonRegexFallback(filePath, code, calls, imports);
  }
}

function pythonRegexFallback(filePath, code, calls, imports) {
  const scanned = stripHashComments(code);
  const errors = [];
  for (const name of calls) {
    errors.push(
      ...matchLines(
        scanned,
        new RegExp(`\\b${name}\\s*\\(`),
        `Direct use of '${name}()' is strictly forbidden.`
      )
    );
  }
  for (const name of imports) {
    errors.push(
      ...matchLines(
        scanned,
        new RegExp(`(?:^|\\s)(?:import\\s+${name}|from\\s+${name}\\s+import)\\b`),
        `Import of deprecated module '${name}' is not allowed.`
      )
    );
  }
  return errors;
}

export function inspectRust(filePath, code, config = CONFIG) {
  if (config.astRules?.rustForbidUnsafe === false) {
    return [];
  }
  return matchLines(
    stripCLikeComments(code),
    /unsafe\s*\{/,
    "Injection of 'unsafe' blocks in Rust source code is strictly forbidden."
  );
}

export function inspectGo(filePath, code, config = CONFIG) {
  if (config.astRules?.goForbidPanic !== true) {
    return [];
  }
  return matchLines(
    stripCLikeComments(code),
    /\bpanic\s*\(/,
    "Unhandled 'panic()' found. Use proper error returning instead."
  );
}

export function inspectDart(filePath, code, config = CONFIG) {
  if (config.astRules?.dartForbidMirrors === false) {
    return [];
  }
  return matchLines(
    stripCLikeComments(code),
    /dart:mirrors/,
    "Import of 'dart:mirrors' is forbidden in agent-authored Flutter/Dart code."
  );
}

export function inspectSwift(filePath, code, config = CONFIG) {
  if (config.astRules?.swiftForbidForceTry === false) {
    return [];
  }
  const scanned = stripCLikeComments(code);
  return [
    ...matchLines(scanned, /\btry!/, "Swift 'try!' is forbidden; handle errors explicitly."),
    ...matchLines(scanned, /\bas!/, "Swift 'as!' force cast is forbidden; use optional casts."),
  ];
}

export function inspectKotlin(filePath, code, config = CONFIG) {
  if (config.astRules?.kotlinForbidBangBang === false) {
    return [];
  }
  const scanned = stripCLikeComments(code);
  return [
    ...matchLines(scanned, /!!/, "Kotlin '!!' force unwrap is forbidden; handle nulls explicitly."),
    ...matchLines(scanned, /\bTODO\s*\(/, "Kotlin TODO() left in source; finish the implementation."),
  ];
}

export function inspectCpp(filePath, code, config = CONFIG) {
  if (config.astRules?.cppForbidUnsafeC === false) {
    return [];
  }
  const scanned = stripCLikeComments(code);
  return [
    ...matchLines(scanned, /\bgets\s*\(/, "C 'gets()' is unsafe and forbidden."),
    ...matchLines(scanned, /\bsystem\s*\(/, "C 'system()' is forbidden; it shells out unsafely."),
  ];
}

export function inspectJava(filePath, code, config = CONFIG) {
  if (config.astRules?.javaForbidRuntimeExec === false) {
    return [];
  }
  return matchLines(
    stripCLikeComments(code),
    /Runtime\.getRuntime\(\)\s*\.exec\s*\(/,
    "Java Runtime.exec() is forbidden in agent-authored code."
  );
}

export function languageIdFor(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (JS_EXTS.has(ext)) return 'javascript';
  if (ext === '.py') return 'python';
  if (ext === '.rs') return 'rust';
  if (ext === '.go') return 'go';
  if (ext === '.dart') return 'dart';
  if (ext === '.swift') return 'swift';
  if (KOTLIN_EXTS.has(ext)) return 'kotlin';
  if (CPP_EXTS.has(ext)) return 'cpp';
  if (ext === '.java') return 'java';
  return null;
}

const INSPECTORS = {
  javascript: inspectJavaScript,
  python: inspectPython,
  rust: inspectRust,
  go: inspectGo,
  dart: inspectDart,
  swift: inspectSwift,
  kotlin: inspectKotlin,
  cpp: inspectCpp,
  java: inspectJava,
};

export function inspectSource(filePath, code, config = CONFIG) {
  if (!filePath || typeof code !== 'string' || code.length === 0) {
    return [];
  }
  const language = languageIdFor(filePath);
  if (!language) {
    return [];
  }
  return INSPECTORS[language](filePath, code, config);
}

export function extractWriteSnippets(toolInput = {}) {
  const snippets = [];
  const defaultPath =
    toolInput.file_path || toolInput.filePath || toolInput.path || toolInput.notebook_path || '';

  if (typeof toolInput.content === 'string' && defaultPath) {
    snippets.push({ filePath: defaultPath, code: toolInput.content });
  } else if (typeof toolInput.new_string === 'string' && defaultPath) {
    snippets.push({ filePath: defaultPath, code: toolInput.new_string });
  }

  if (Array.isArray(toolInput.edits)) {
    for (const edit of toolInput.edits) {
      const filePath = edit.file_path || defaultPath;
      const code = edit.new_string || edit.content || '';
      if (filePath && code) {
        snippets.push({ filePath, code });
      }
    }
  }

  return snippets;
}

export function formatInspectBlock(filePath, errors) {
  return (
    `Source policy violations in "${filePath}":\n` +
    errors.map((entry) => ` - ${entry}`).join('\n')
  );
}
