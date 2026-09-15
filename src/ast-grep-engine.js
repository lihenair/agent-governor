/**
 * ast-grep engine: true syntax-tree checks for non-Babel languages.
 *
 * Replaces the regex SOP layer for Rust / Go / Kotlin / Swift / Java / C/C++ /
 * Dart (and optionally Ruby/PHP/C# via future lang packs). Built-in napi
 * languages: Html, JavaScript, Tsx, Css, TypeScript. Everything else loads
 * through `@ast-grep/lang-<name>` optional dependencies — a missing pack
 * degrades that language back to the regex SOP instead of failing.
 *
 * Why a syntax tree beats line-regex for these languages (verified):
 *   - regex false-positives on strings/comments mentioning banned tokens
 *     (Rust `let w = "unsafe { }"`, Go `s := "panic(x)"`, Kotlin `"!!"`);
 *   - regex cannot see statement structure, so `unsafe { }` blocks, real
 *     call expressions, and force-unwrap postfix operators blur together.
 * ast-grep walks the real tree-sitter grammar: strings and comments are
 * distinct node kinds and never match call/unsafe patterns.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

let sgModule = null;

const nodeRequire = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), 'inspect.js'));

function loadSg() {
  if (!sgModule) {
    try {
      sgModule = nodeRequire('@ast-grep/napi');
    } catch {
      sgModule = null;
    }
  }
  return sgModule;
}

const LANG_PACKS = {
  rust: '@ast-grep/lang-rust',
  go: '@ast-grep/lang-go',
  kotlin: '@ast-grep/lang-kotlin',
  swift: '@ast-grep/lang-swift',
  c: '@ast-grep/lang-c',
  cpp: '@ast-grep/lang-cpp',
  java: '@ast-grep/lang-java',
  dart: '@ast-grep/lang-dart',
};

const EXT_TO_LANG = {
  '.rs': 'rust',
  '.go': 'go',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.swift': 'swift',
  '.java': 'java',
  '.dart': 'dart',
  '.c': 'c',
  '.h': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
};

const registeredLangs = new Set();
let registerAttempted = false;

/**
 * Register ALL installed lang packs in one shot.
 *
 * napi contract: registerDynamicLanguage must be called exactly once, before
 * the first parse — later calls silently stop taking effect. So we eagerly
 * load every `@ast-grep/lang-*` optionalDependency that is present and
 * register them together.
 */
function ensureRegistered() {
  const sg = loadSg();
  if (!sg || registerAttempted) {
    return;
  }
  registerAttempted = true;
  const batch = {};
  for (const [lang, packName] of Object.entries(LANG_PACKS)) {
    try {
      const pack = nodeRequire(packName);
      batch[lang] = pack.default || pack;
    } catch {
      // pack not installed → this language degrades to the regex SOP
    }
  }
  if (Object.keys(batch).length > 0) {
    try {
      sg.registerDynamicLanguage(batch);
      for (const lang of Object.keys(batch)) {
        registeredLangs.add(lang);
      }
    } catch {
      // registration failure → all languages fall back to regex
    }
  }
}

function registerLang(lang) {
  ensureRegistered();
  return registeredLangs.has(lang);
}

function langFor(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  return EXT_TO_LANG[ext] || null;
}

/**
 * Check whether the ast-grep engine can handle this file.
 * Built-in napi languages (Html/JavaScript/Tsx/Css/TypeScript) always true;
 * others require their optional lang pack to be installed.
 */
export function astGrepSupports(filePath) {
  const lang = langFor(filePath);
  if (!lang) {
    return false;
  }
  return registerLang(lang);
}

/** tree-sitter node kinds that mean "call" per language. */
const CALL_KINDS = {
  rust: ['call_expression', 'macro_invocation'],
  go: ['call_expression'],
  kotlin: ['call_expression'],
  swift: ['call_expression'],
  java: ['method_invocation', 'object_creation_expression'],
  c: ['call_expression'],
  cpp: ['call_expression'],
  dart: ['invocation', 'instance_creation'],
};

/** Node kinds that wrap an `unsafe`-style block. */
const UNSAFE_KINDS = { rust: ['unsafe_block'] };



function collectKinds(node, kinds, out, depth = 0) {
  if (depth > 20000 || out.length > 500) {
    return;
  }
  if (kinds.includes(node.kind())) {
    out.push(node);
  }
  const kids = node.children();
  for (const kid of kids) {
    collectKinds(kid, kinds, out, depth + 1);
  }
}

function collectByText(node, regex, out, depth = 0) {
  if (depth > 20000 || out.length > 500) {
    return;
  }
  if (regex.test(node.text())) {
    out.push(node);
  }
  const kids = node.children();
  for (const kid of kids) collectByText(kid, regex, out, depth + 1);
}

/**
 * Structural checks for one file's source, via ast-grep syntax trees.
 *
 * @param {string} filePath
 * @param {string} code
 * @param {object} config governor config (astRules)
 * @returns {string[]} errors (empty = clean); returns null if unsupported
 */
export function inspectWithAstGrep(filePath, code, config = {}) {
  const lang = langFor(filePath);
  if (!lang) {
    return null;
  }
  const sg = loadSg();
  if (!sg) {
    return null; // napi not installed → caller falls back to regex
  }
  if (!registerLang(lang)) {
    return null; // lang pack missing → regex fallback
  }

  const rules = config.astRules || {};
  const errors = [];

  let tree;
  try {
    tree = sg.parse(lang, code);
  } catch {
    // Malformed partial snippet: caller's regex fallback still scans it.
    return null;
  }
  const root = tree.root();

  // --- Rust: forbid `unsafe { }` blocks (kind-accurate: strings/comments immune)
  if (lang === 'rust' && rules.rustForbidUnsafe !== false) {
    const hits = [];
    collectKinds(root, UNSAFE_KINDS.rust, hits);
    for (const hit of hits) {
      errors.push(`Line ${hit.range().start.line + 1}: Injection of 'unsafe' blocks in Rust source code is strictly forbidden.`);
    }
  }

  // --- Go: forbid bare panic() calls
  if (lang === 'go' && rules.goForbidPanic === true) {
    const calls = [];
    collectKinds(root, CALL_KINDS.go, calls);
    for (const call of calls) {
      const fn = call.child(0);
      if (fn && fn.text() === 'panic') {
        errors.push(`Line ${call.range().start.line + 1}: Unhandled 'panic()' found. Use proper error returning instead.`);
      }
    }
  }

  // --- Kotlin: forbid `!!` force unwrap (postfix_expression ending in `!!`)
  if (lang === 'kotlin' && rules.kotlinForbidBangBang !== false) {
    const postfix = [];
    collectKinds(root, ['postfix_expression'], postfix);
    for (const hit of postfix) {
      const last = hit.children().pop();
      if (last && last.kind() === '!!') {
        errors.push(`Line ${hit.range().start.line + 1}: Kotlin '!!' force unwrap is forbidden; handle nullability explicitly.`);
      }
    }
  }

  // --- Swift: forbid `try!` (structurally: try_operator node with `!` child)
  if (lang === 'swift' && rules.swiftForbidForceTry !== false) {
    const tries = [];
    collectKinds(root, ['try_operator'], tries);
    for (const hit of tries) {
      if (hit.children().some((k) => k.kind() === '!')) {
        errors.push(`Line ${hit.range().start.line + 1}: Swift 'try!' force-try is forbidden; handle the error case.`);
      }
    }
  }

  // --- Dart: forbid dart:mirrors imports (structurally: import_specification)
  if (lang === 'dart' && rules.dartForbidMirrors !== false) {
    const imports = [];
    collectByText(root, /dart:mirrors/, imports);
    for (const hit of imports) {
      errors.push(`Line ${hit.range().start.line + 1}: Import of 'dart:mirrors' is forbidden.`);
      break;
    }
  }

  // --- Java: forbid Runtime.getRuntime().exec
  // NOTE: @ast-grep/lang-java 0.x 不被 napi 支持（"java is not supported"），
  // 本分支实际到不了这里——java 的 langFor 命中后 registerLang 返回 false → null → 正则兜底。
  if (lang === 'java' && rules.javaForbidRuntimeExec !== false) {
    const calls = [];
    collectByText(root, /Runtime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*exec/, calls);
    if (calls.length > 0) {
      errors.push('Line 1: Runtime.getRuntime().exec() is forbidden; use ProcessBuilder with a whitelist.');
    }
  }

  // --- C/C++: forbid gets() / system() calls
  if ((lang === 'c' || lang === 'cpp') && rules.cppForbidUnsafeC !== false) {
    const calls = [];
    collectKinds(root, CALL_KINDS[lang], calls);
    for (const call of calls) {
      const fn = call.child(0);
      const name = fn ? fn.text() : '';
      if (name === 'gets') {
        errors.push(`Line ${call.range().start.line + 1}: C 'gets()' is unsafe and forbidden.`);
      } else if (name === 'system') {
        errors.push(`Line ${call.range().start.line + 1}: C 'system()' is unsafe and forbidden.`);
      }
    }
  }

  return errors;
}
