import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { getPreset, bindPresetsToConfig } from './presets.js';

// Break the config <-> presets circular import: presets need the default
// lists at preset-build time, config needs getPreset at load time.
let _presetsBound = false;
function ensurePresetsBound() {
  if (!_presetsBound) {
    bindPresetsToConfig(CONFIG);
    _presetsBound = true;
  }
}

/**
 * Default governance rules. Projects can override / extend these via
 * `governor.config.js` at the repository root.
 */
export const CONFIG = {
  protectedFiles: [
    'tsconfig.json',
    'tsconfig.node.json',
    'biome.json',
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.json',
    '.prettierrc',
    '.prettierrc.js',
    '.prettierrc.json',
    'package.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'package-lock.json',
    'pyproject.toml',
    'requirements.txt',
    'setup.py',
    'setup.cfg',
    'Pipfile',
    'Pipfile.lock',
    'Cargo.toml',
    'Cargo.lock',
    'go.mod',
    'go.sum',
    'CMakeLists.txt',
    'Makefile',
    'pubspec.yaml',
    'pubspec.lock',
    'Podfile',
    'Podfile.lock',
    'Package.swift',
    'build.gradle',
    'settings.gradle',
    'settings.gradle.kts',
    'AndroidManifest.xml',
    'governor.config.js',
    'governor.config.cjs',
    'governor.config.mjs',
    'governor.config.json',
  ],

  protectedDirectories: ['.claude/', '.agent-governor/'],

  codeExtensions: [
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.ts',
    '.tsx',
    '.py',
    '.rs',
    '.go',
    '.dart',
    '.swift',
    '.kt',
    '.kts',
    '.java',
    '.c',
    '.h',
    '.cc',
    '.cpp',
    '.hpp',
  ],

  forbiddenBashPatterns: [
    /git\s+commit[\s\S]*--no-verify/i,
    /git\s+push[\s\S]*--no-verify/i,
    /rm\s+-rf\s+\.git\b/i,
    /npm\s+set\s+strict-ssl\s+false/i,
    /pip(?:3)?\s+install[\s\S]*--insecure/i,
    /cargo\s+publish[\s\S]*--no-verify/i,
    /git\s+push[\s\S]*--force(?:-with-lease)?/i,
    /git\s+push[\s\S]*\s-f\s+(?:origin\s+)?(?:main|master)\b/i,
  ],

  astRules: {
    noDirectEval: true,
    noNewFunction: true,
    requireErrorBoundary: false,
    pythonForbiddenCalls: ['eval', 'exec'],
    pythonDeprecatedImports: ['imp', 'optparse'],
    rustForbidUnsafe: true,
    goForbidPanic: false,
    dartForbidMirrors: true,
    swiftForbidForceTry: true,
    kotlinForbidBangBang: true,
    cppForbidUnsafeC: true,
    javaForbidRuntimeExec: true,
  },

  /**
   * Read-side prompt injection scanning on Read/WebFetch/WebSearch content.
   * 'scan' (default) = detect and block/ warn; 'off' = disable entirely.
   */
  injectionMode: 'scan',

  /**
   * Optional extra injection detectors: [{ id, weight, pattern }] where
   * pattern is a regex source string (case-insensitive) or RegExp.
   */
  injectionPatterns: [],
};

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export function isWriteTool(toolName) {
  return WRITE_TOOLS.has(toolName);
}

export function resolveProjectRoot(payload = {}, cwd = process.cwd()) {
  return (
    process.env.CLAUDE_PROJECT_DIR ||
    payload.cwd ||
    cwd
  );
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

function normalizePattern(pattern) {
  if (pattern instanceof RegExp) {
    return pattern;
  }
  if (typeof pattern === 'string') {
    return new RegExp(pattern, 'i');
  }
  return null;
}

export function mergeConfig(base, override = {}) {
  const replace = override.override === true;
  const astRules = replace
    ? { ...(override.astRules || base.astRules || {}) }
    : {
        ...base.astRules,
        ...(override.astRules || {}),
      };

  const mergeList = (key) => {
    if (replace && Object.prototype.hasOwnProperty.call(override, key)) {
      return unique(override[key] || []);
    }
    return unique([...(base[key] || []), ...(override[key] || [])]);
  };

  const unprotect = new Set(override.unprotect || []);
  const protectedFiles = mergeList('protectedFiles').filter((name) => !unprotect.has(name));

  const forbidden = replace && Object.prototype.hasOwnProperty.call(override, 'forbiddenBashPatterns')
    ? override.forbiddenBashPatterns || []
    : [...(base.forbiddenBashPatterns || []), ...(override.forbiddenBashPatterns || [])];

  return {
    ...base,
    ...override,
    protectedFiles,
    protectedDirectories: mergeList('protectedDirectories'),
    codeExtensions: mergeList('codeExtensions'),
    forbiddenBashPatterns: forbidden.map(normalizePattern).filter(Boolean),
    astRules,
  };
}

async function importConfigModule(filePath) {
  const errors = [];

  try {
    const require = createRequire(pathToFileURL(filePath).href);
    const loaded = require(filePath);
    return loaded?.default ?? loaded;
  } catch (err) {
    errors.push(err);
  }

  try {
    const mod = await import(`${pathToFileURL(filePath).href}?t=${Date.now()}`);
    return mod.default ?? mod;
  } catch (err) {
    errors.push(err);
  }

  const last = errors[errors.length - 1];
  throw last;
}

export function toJsonConfig(config = CONFIG) {
  return {
    protectedFiles: config.protectedFiles,
    protectedDirectories: config.protectedDirectories,
    forbiddenBashPatterns: (config.forbiddenBashPatterns || []).map((pattern) =>
      pattern instanceof RegExp ? pattern.source : String(pattern)
    ),
    astRules: config.astRules,
    injectionMode: config.injectionMode || 'scan',
    injectionPatterns: config.injectionPatterns || [],
  };
}

export async function loadConfig(cwd = process.cwd()) {
  // Preset via env (set by `--preset` CLI flag) or governor.config.json field.
  const presetName = process.env.GOVERNOR_PRESET || '';
  ensurePresetsBound();
  const candidates = [
    path.join(cwd, 'governor.config.json'),
    path.join(cwd, 'governor.config.cjs'),
    path.join(cwd, 'governor.config.js'),
    path.join(cwd, 'governor.config.mjs'),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    if (filePath.endsWith('.json')) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      // File-level `preset` field wins over the env var; both feed getPreset.
      const preset = getPreset(parsed.preset || presetName);
      return mergeConfig(mergeConfig(CONFIG, preset), parsed);
    }

    const loaded = await importConfigModule(filePath);
    const preset = getPreset(loaded?.preset || presetName);
    return mergeConfig(mergeConfig(CONFIG, preset), loaded);
  }

  const preset = getPreset(presetName);
  return mergeConfig(CONFIG, preset);
}

export function extractFilePaths(toolName, toolInput = {}) {
  const paths = [];
  const candidates = [
    toolInput.file_path,
    toolInput.filePath,
    toolInput.path,
    toolInput.notebook_path,
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.length > 0) {
      paths.push(value);
    }
  }

  if (Array.isArray(toolInput.edits)) {
    for (const edit of toolInput.edits) {
      if (typeof edit?.file_path === 'string') {
        paths.push(edit.file_path);
      }
    }
  }

  return unique(paths);
}

export function isProtectedFileName(fileName, config = CONFIG) {
  return config.protectedFiles.includes(fileName);
}

export function isProtectedDirectory(targetFilePath, config = CONFIG, projectRoot = process.cwd()) {
  if (!targetFilePath) {
    return false;
  }

  const resolved = path.resolve(projectRoot, targetFilePath);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return false;
  }

  const normalized = relative.split(path.sep).join('/');

  return (config.protectedDirectories || []).some((dir) => {
    const trimmed = dir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!trimmed) {
      return false;
    }

    return normalized === trimmed || normalized.startsWith(`${trimmed}/`);
  });
}
