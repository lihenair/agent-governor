import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

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
    'governor.config.js',
    'governor.config.cjs',
    'governor.config.mjs',
    'governor.config.json',
  ],

  protectedDirectories: ['.claude/', '.agent-governor/'],

  codeExtensions: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'],

  forbiddenBashPatterns: [
    /git\s+commit[\s\S]*--no-verify/i,
    /git\s+push[\s\S]*--no-verify/i,
    /rm\s+-rf\s+\.git\b/i,
    /npm\s+set\s+strict-ssl\s+false/i,
    /git\s+push[\s\S]*--force(?:-with-lease)?\s+(?:origin\s+)?(?:main|master)\b/i,
    /git\s+push[\s\S]*\s-f\s+(?:origin\s+)?(?:main|master)\b/i,
  ],

  astRules: {
    noDirectEval: true,
    noNewFunction: true,
    requireErrorBoundary: false,
  },
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
  const astRules = {
    ...base.astRules,
    ...(override.astRules || {}),
  };

  return {
    ...base,
    ...override,
    protectedFiles: unique([
      ...(base.protectedFiles || []),
      ...(override.protectedFiles || []),
    ]),
    protectedDirectories: unique([
      ...(base.protectedDirectories || []),
      ...(override.protectedDirectories || []),
    ]),
    codeExtensions: unique([
      ...(base.codeExtensions || []),
      ...(override.codeExtensions || []),
    ]),
    forbiddenBashPatterns: [
      ...(base.forbiddenBashPatterns || []),
      ...(override.forbiddenBashPatterns || []),
    ]
      .map(normalizePattern)
      .filter(Boolean),
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

export async function loadConfig(cwd = process.cwd()) {
  const candidates = [
    path.join(cwd, 'governor.config.cjs'),
    path.join(cwd, 'governor.config.js'),
    path.join(cwd, 'governor.config.mjs'),
    path.join(cwd, 'governor.config.json'),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    if (filePath.endsWith('.json')) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return mergeConfig(CONFIG, parsed);
    }

    const loaded = await importConfigModule(filePath);
    return mergeConfig(CONFIG, loaded);
  }

  return mergeConfig(CONFIG, {});
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
  const normalized = relative.split(path.sep).join('/');
  const absoluteNormalized = resolved.split(path.sep).join('/');

  return config.protectedDirectories.some((dir) => {
    const trimmed = dir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!trimmed) {
      return false;
    }

    return (
      normalized === trimmed ||
      normalized.startsWith(`${trimmed}/`) ||
      normalized.includes(`/${trimmed}/`) ||
      absoluteNormalized.includes(`/${trimmed}/`) ||
      absoluteNormalized.endsWith(`/${trimmed}`)
    );
  });
}
