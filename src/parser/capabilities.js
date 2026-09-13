import path from 'node:path';

function basename(program) {
  return path.basename(String(program || '')).replace(/\.exe$/i, '');
}

function blobOf(program, args, payloads) {
  return [program, ...(args || []), ...(payloads || [])].join(' ');
}

function hasGitForce(text) {
  return (
    /git[\s'",\]\[]+push[\s\S]{0,80}(?:--force(?:-with-lease)?|\s-f\b)/i.test(text) ||
    /['"]git['"]\s*,\s*['"]push['"][\s\S]{0,80}['"]--force/i.test(text)
  );
}

function hasHookBypass(text) {
  return /--no-verify/i.test(text);
}

function hasBranchDelete(text) {
  return /git[\s'",\]\[]+branch[\s\S]{0,40}(?:-D|--delete)/i.test(text);
}

function looksLikeSecretPath(text) {
  return (
    /(?:^|[\s/'"])(?:id_rsa|id_ed25519|\.aws\/credentials|\.npmrc|\.netrc|\/etc\/shadow|\.env(?:\.local)?)(?:$|[\s'"])/i.test(
      text
    ) || /\$\(cat\s+[^\)]*(?:id_rsa|credentials|\.env)/i.test(text)
  );
}

function looksLikeCiPath(text) {
  return /\.github\/workflows\//i.test(text) || /\.gitlab-ci\.yml/i.test(text);
}

/**
 * Map a program + argv (+ nested payloads) to capability tags.
 *
 * @param {string} program
 * @param {string[]} args
 * @param {{payloads?: string[]}} [options]
 * @returns {string[]}
 */
export function capabilitiesFor(program, args = [], options = {}) {
  const name = basename(program);
  const payloads = options.payloads || [];
  const text = blobOf(program, args, payloads);
  const caps = new Set();

  const dynamicInterp =
    ((name === 'python' || name === 'python3' || name === 'pypy') && args.includes('-c')) ||
    (name === 'node' && (args.includes('-e') || args.includes('--eval'))) ||
    (name === 'npx' || name === 'make' || (name === 'docker' && args[0] === 'run')) ||
    ((name === 'bash' || name === 'sh' || name === 'zsh') && args.includes('-c')) ||
    /\|\s*(?:bash|sh)\b/.test(text);

  if (dynamicInterp) {
    caps.add('process.spawn.dynamic');
  }
  if (name === 'bash' || name === 'sh' || name === 'zsh' || name === 'sudo') {
    caps.add('process.spawn');
  }

  if (hasGitForce(text)) caps.add('git.push.force');
  if (hasHookBypass(text)) caps.add('git.hook.bypass');
  if (hasBranchDelete(text)) caps.add('git.branch.delete');

  if (
    name === 'rm' ||
    /(?:^|[\s;|&])rm\s+-r?f/i.test(text) ||
    /shutil\.rmtree|rmtree\s*\(/i.test(text)
  ) {
    caps.add('fs.delete');
  }

  if (
    ['tee', 'cp', 'mv', 'dd', 'install'].includes(name) ||
    (name === 'sed' && args.some((arg) => arg === '-i' || arg === '--in-place' || arg.startsWith('--in-place='))) ||
    /(?:^|[\s])>{1,2}\s*\S+/.test(text)
  ) {
    caps.add('fs.write');
  }

  if (name === 'chmod' || name === 'chown' || name === 'chgrp') {
    caps.add('fs.permission');
  }

  if (
    (name === 'npm' && args[0] === 'pkg' && args[1] === 'set') ||
    (name === 'yarn' && args[0] === 'config' && args[1] === 'set') ||
    (name === 'npm' && args[0] === 'set')
  ) {
    caps.add('config.modify');
  }

  if (looksLikeCiPath(text)) {
    caps.add('ci.modify');
  }

  if (name === 'npm' && args[0] === 'install') {
    caps.add('package.install');
  }
  if ((name === 'pip' || name === 'pip3') && args.includes('install')) {
    caps.add('package.install');
  }
  if (name === 'yarn' && args[0] && args[0] !== 'config' && args[0] !== 'test') {
    caps.add('package.install');
  }
  if (name === 'pnpm' && (args[0] === 'add' || args[0] === 'install')) {
    caps.add('package.install');
  }

  if ((name === 'bash' || name === 'sh' || name === 'zsh') && args.length === 0) {
    caps.add('process.spawn.dynamic');
  }

  if (
    looksLikeSecretPath(text) ||
    ((name === 'cat' || name === 'less' || name === 'head' || name === 'tail') &&
      looksLikeSecretPath(args.join(' ')))
  ) {
    caps.add('secrets.read');
  }

  if (name === 'curl' || name === 'wget' || name === 'fetch' || /https?:\/\//i.test(text)) {
    caps.add('net.request');
  }

  if (name === 'cat' && !caps.has('secrets.read')) {
    caps.add('fs.read');
  }

  return [...caps];
}

export const CAPABILITY_DENY_ORDER = [
  'git.push.force',
  'git.hook.bypass',
  'git.branch.delete',
  'fs.delete',
  'config.modify',
  'ci.modify',
  'secrets.read',
  'fs.permission',
];
