import path from 'node:path';
import { parseShell as parse } from './parser/shell-tokens.js';

function tokenSegments(command) {
  let tokens;
  try {
    tokens = parse(command);
  } catch {
    return [];
  }

  const groups = [[]];
  for (const token of tokens) {
    if (token && typeof token === 'object' && token.op) {
      groups.push([]);
      continue;
    }
    if (typeof token === 'string' && token.length > 0) {
      groups[groups.length - 1].push(token);
    }
  }
  return groups.filter((group) => group.length > 0);
}

function programName(argv0) {
  return path.basename(argv0 || '');
}

function positionalArgs(args) {
  return args.filter((arg) => arg !== '-' && !arg.startsWith('-'));
}

/**
 * Extract write-like destination paths from a simple argv.
 *
 * @param {string[]} argv
 * @returns {{files: string[], forcedName?: string}}
 */
export function writeTargetsFromArgv(argv) {
  if (!argv.length) {
    return { files: [] };
  }

  const prog = programName(argv[0]);
  const args = argv.slice(1);

  if (prog === 'npm' && args[0] === 'pkg' && args[1] === 'set') {
    return { files: [], forcedName: 'package.json' };
  }
  if (prog === 'yarn' && args[0] === 'config' && args[1] === 'set') {
    return { files: [], forcedName: 'package.json' };
  }

  if (prog === 'sed') {
    const inplace = args.some(
      (arg) => arg === '-i' || arg === '--in-place' || arg.startsWith('--in-place=')
    );
    if (inplace) {
      return { files: positionalArgs(args) };
    }
  }

  if (prog === 'cp' || prog === 'mv' || prog === 'install') {
    const pos = positionalArgs(args);
    return { files: pos.slice(-1) };
  }

  if (prog === 'tee') {
    return { files: positionalArgs(args) };
  }

  if (prog === 'git' && args[0] === 'restore') {
    return { files: positionalArgs(args.slice(1)) };
  }

  if (prog === 'git' && args[0] === 'checkout' && args.includes('--')) {
    return { files: args.slice(args.indexOf('--') + 1).filter((arg) => arg.length > 0) };
  }

  if (prog === 'jq') {
    return { files: positionalArgs(args).slice(1) };
  }

  if (prog === 'perl' || prog === 'ruby') {
    const inplace = args.some((arg) => arg === '-pi' || arg.startsWith('-i') || arg === '-p');
    if (inplace) {
      return { files: positionalArgs(args) };
    }
  }

  return { files: [] };
}

function protectedName(fileArg, config, projectRoot) {
  const cleaned = String(fileArg || '').replace(/^['"]|['"]$/g, '');
  if (!cleaned) {
    return null;
  }
  const base = path.basename(cleaned);
  if ((config.protectedFiles || []).includes(base)) {
    return base;
  }
  const resolved = path.resolve(projectRoot || process.cwd(), cleaned);
  const resolvedBase = path.basename(resolved);
  if ((config.protectedFiles || []).includes(resolvedBase)) {
    return resolvedBase;
  }
  return null;
}

/**
 * @returns {string|null} protected file basename if the command would write it
 */
export function protectedWriteViaBash(command, config, projectRoot) {
  for (const argv of tokenSegments(command)) {
    const { files, forcedName } = writeTargetsFromArgv(argv);
    if (forcedName && (config.protectedFiles || []).includes(forcedName)) {
      return forcedName;
    }
    for (const fileArg of files) {
      const name = protectedName(fileArg, config, projectRoot);
      if (name) {
        return name;
      }
    }
  }
  return null;
}
