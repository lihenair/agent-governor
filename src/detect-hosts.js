/**
 * Discover which coding-agent hosts look present on this machine / repo,
 * and whether they are already wired to agent-governor.
 *
 * Detection never writes files. `init` prints this table and waits for an
 * explicit host list before creating any host-specific config.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { HOSTS } from './hosts.js';

export const HOST_ALIASES = {
  claude: 'claude-code',
  'claude-code': 'claude-code',
  cursor: 'cursor',
  codex: 'codex',
  gemini: 'gemini-cli',
  'gemini-cli': 'gemini-cli',
  windsurf: 'windsurf',
  cascade: 'windsurf',
  opencode: 'opencode',
};

const GOVERNOR_NEEDLE = 'agent-governor';

function defaultIo() {
  return {
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync,
    readdirSync: fs.readdirSync,
    statSync: fs.statSync,
  };
}

function isNonEmptyDir(dir, io) {
  if (!io.existsSync(dir)) {
    return false;
  }
  try {
    const stat = io.statSync(dir);
    if (!stat.isDirectory()) {
      return true;
    }
    return io.readdirSync(dir).filter((name) => name !== '.' && name !== '..').length > 0;
  } catch {
    return false;
  }
}

function readText(filePath, io) {
  try {
    return io.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function mentionsGovernor(filePath, io) {
  return readText(filePath, io).includes(GOVERNOR_NEEDLE);
}

function commandOnPath(name, env = process.env) {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  const raw = (pathKey && env[pathKey]) || '';
  const exts =
    process.platform === 'win32'
      ? String(env.PATHEXT || '.EXE;.CMD;.BAT;.CMD;.COM')
          .split(';')
          .filter(Boolean)
      : [''];
  for (const dir of raw.split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.existsSync(candidate)) {
          return true;
        }
      } catch {
        // ignore unreadable PATH entries
      }
    }
  }
  return false;
}

function pickPresence(project, user, machine) {
  if (project) {
    return 'project';
  }
  if (user) {
    return 'user';
  }
  if (machine) {
    return 'machine';
  }
  return 'absent';
}

function cursorUserDirs(home) {
  if (process.platform === 'darwin') {
    return [
      path.join(home, 'Library', 'Application Support', 'Cursor'),
      path.join(home, '.cursor'),
    ];
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return [path.join(appData, 'Cursor'), path.join(home, '.cursor')];
  }
  return [path.join(home, '.config', 'Cursor'), path.join(home, '.cursor')];
}

function inspectClaude(projectRoot, home, io, { scanUser, scanPath, env }) {
  const projectSettings = [
    path.join(projectRoot, '.claude', 'settings.json'),
    path.join(projectRoot, '.claude', 'settings.local.json'),
  ];
  const projectClaudeDir = path.join(projectRoot, '.claude');
  const projectPluginDir = path.join(projectRoot, '.claude-plugin');
  const projectPresent =
    projectSettings.some((file) => io.existsSync(file)) ||
    isNonEmptyDir(projectClaudeDir, io) ||
    isNonEmptyDir(projectPluginDir, io);

  const userClaude = path.join(home, '.claude');
  const userPresent = scanUser && isNonEmptyDir(userClaude, io);
  const machine = scanPath && commandOnPath('claude', env);

  const fileGoverned = projectSettings.some((file) => mentionsGovernor(file, io));
  const userSettings = path.join(home, '.claude', 'settings.json');
  const userFileGoverned = scanUser && mentionsGovernor(userSettings, io);

  const pluginHints = [
    path.join(projectRoot, '.claude', 'plugins', 'agent-governor'),
    path.join(home, '.claude', 'plugins', 'agent-governor'),
    path.join(projectRoot, '.claude-plugin', 'plugin.json'),
  ];
  const pluginGoverned = pluginHints.some((item) => {
    if (!io.existsSync(item)) {
      return false;
    }
    try {
      if (io.statSync(item).isDirectory()) {
        return true;
      }
    } catch {
      // fall through to needle check
    }
    return mentionsGovernor(item, io);
  });

  // A marketplace manifest in *this* package is the plugin source, not proof
  // the current project installed it. Only treat plugin.json as governed-plugin
  // when it lives under the user's Claude plugin install dir, not repo source.
  const governedViaPlugin =
    io.existsSync(path.join(projectRoot, '.claude', 'plugins', 'agent-governor')) ||
    (scanUser && io.existsSync(path.join(home, '.claude', 'plugins', 'agent-governor')));

  let governed = 'no';
  if (fileGoverned || userFileGoverned) {
    governed = 'file';
  } else if (governedViaPlugin || (pluginGoverned && fileGoverned)) {
    governed = 'plugin';
  } else if (governedViaPlugin) {
    governed = 'plugin';
  }

  return {
    id: 'claude-code',
    presence: pickPresence(projectPresent, userPresent, machine),
    governed,
    write: 'repo .claude/settings.json',
    evidence: [
      projectPresent ? 'project .claude/' : null,
      userPresent ? 'user ~/.claude/' : null,
      machine ? 'PATH claude' : null,
    ].filter(Boolean),
  };
}

function inspectCursor(projectRoot, home, io, { scanUser, scanPath, env }) {
  const projectDir = path.join(projectRoot, '.cursor');
  const hooks = path.join(projectDir, 'hooks.json');
  const projectPresent = io.existsSync(hooks) || isNonEmptyDir(projectDir, io);
  const userDirs = cursorUserDirs(home);
  const userPresent = scanUser && userDirs.some((dir) => isNonEmptyDir(dir, io));
  const machine = scanPath && commandOnPath('cursor', env);
  const governed = mentionsGovernor(hooks, io) ? 'file' : 'no';
  return {
    id: 'cursor',
    presence: pickPresence(projectPresent, userPresent, machine),
    governed,
    write: 'repo .cursor/hooks.json',
    evidence: [
      projectPresent ? 'project .cursor/' : null,
      userPresent ? 'user Cursor config dir' : null,
      machine ? 'PATH cursor' : null,
    ].filter(Boolean),
  };
}

function inspectCodex(projectRoot, home, io, { scanUser, scanPath, env }) {
  const projectDir = path.join(projectRoot, '.codex');
  const projectHooks = path.join(projectDir, 'hooks.json');
  const userDir = path.join(home, '.codex');
  const userHooks = path.join(userDir, 'hooks.json');
  const userToml = path.join(userDir, 'config.toml');
  const projectPresent = io.existsSync(projectHooks) || isNonEmptyDir(projectDir, io);
  const userPresent =
    scanUser && (io.existsSync(userHooks) || io.existsSync(userToml) || isNonEmptyDir(userDir, io));
  const machine = scanPath && commandOnPath('codex', env);
  const governed =
    mentionsGovernor(projectHooks, io) || mentionsGovernor(userHooks, io) || mentionsGovernor(userToml, io)
      ? 'file'
      : 'no';
  return {
    id: 'codex',
    presence: pickPresence(projectPresent, userPresent, machine),
    governed,
    write: projectPresent ? 'repo .codex/hooks.json' : 'user ~/.codex/hooks.json',
    evidence: [
      projectPresent ? 'project .codex/' : null,
      userPresent ? 'user ~/.codex/' : null,
      machine ? 'PATH codex' : null,
    ].filter(Boolean),
  };
}

function inspectGemini(projectRoot, home, io, { scanUser, scanPath, env }) {
  const projectSettings = path.join(projectRoot, '.gemini', 'settings.json');
  const projectDir = path.join(projectRoot, '.gemini');
  const userSettings = path.join(home, '.gemini', 'settings.json');
  const userDir = path.join(home, '.gemini');
  const projectPresent = io.existsSync(projectSettings) || isNonEmptyDir(projectDir, io);
  const userPresent = scanUser && (io.existsSync(userSettings) || isNonEmptyDir(userDir, io));
  const machine = scanPath && commandOnPath('gemini', env);
  const governed =
    mentionsGovernor(projectSettings, io) || mentionsGovernor(userSettings, io) ? 'file' : 'no';
  return {
    id: 'gemini-cli',
    presence: pickPresence(projectPresent, userPresent, machine),
    governed,
    write: projectPresent ? 'repo .gemini/settings.json' : 'user ~/.gemini/settings.json',
    evidence: [
      projectPresent ? 'project .gemini/' : null,
      userPresent ? 'user ~/.gemini/' : null,
      machine ? 'PATH gemini' : null,
    ].filter(Boolean),
  };
}

function inspectWindsurf(projectRoot, home, io, { scanUser, scanPath, env }) {
  const projectHooks = path.join(projectRoot, '.windsurf', 'hooks.json');
  const projectDir = path.join(projectRoot, '.windsurf');
  const userHooks = path.join(home, '.codeium', 'windsurf', 'hooks.json');
  const userDir = path.join(home, '.codeium', 'windsurf');
  const projectPresent = io.existsSync(projectHooks) || isNonEmptyDir(projectDir, io);
  const userPresent = scanUser && (io.existsSync(userHooks) || isNonEmptyDir(userDir, io));
  const machine = scanPath && (commandOnPath('windsurf', env) || commandOnPath('cascade', env));
  const governed =
    mentionsGovernor(projectHooks, io) || mentionsGovernor(userHooks, io) ? 'file' : 'no';
  return {
    id: 'windsurf',
    presence: pickPresence(projectPresent, userPresent, machine),
    governed,
    write: projectPresent ? 'repo .windsurf/hooks.json' : 'user ~/.codeium/windsurf/hooks.json',
    evidence: [
      projectPresent ? 'project .windsurf/' : null,
      userPresent ? 'user ~/.codeium/windsurf/' : null,
      machine ? 'PATH windsurf' : null,
    ].filter(Boolean),
  };
}

function inspectOpencode(projectRoot, home, io, { scanUser, scanPath, env }) {
  const projectPlugin = path.join(projectRoot, '.opencode', 'plugins', 'agent-governor.js');
  const projectDir = path.join(projectRoot, '.opencode');
  const userPlugin = path.join(home, '.config', 'opencode', 'plugins', 'agent-governor.js');
  const userDir = path.join(home, '.config', 'opencode');
  const projectPresent = io.existsSync(projectPlugin) || isNonEmptyDir(projectDir, io);
  const userPresent = scanUser && (io.existsSync(userPlugin) || isNonEmptyDir(userDir, io));
  const machine = scanPath && commandOnPath('opencode', env);
  const governed = io.existsSync(projectPlugin) || io.existsSync(userPlugin) ? 'file' : 'no';
  return {
    id: 'opencode',
    presence: pickPresence(projectPresent, userPresent, machine),
    governed,
    write: 'repo .opencode/plugins/agent-governor.js',
    evidence: [
      projectPresent ? 'project .opencode/' : null,
      userPresent ? 'user ~/.config/opencode/' : null,
      machine ? 'PATH opencode' : null,
    ].filter(Boolean),
  };
}

/**
 * @typedef {object} HostDetection
 * @property {string} id
 * @property {'absent'|'project'|'user'|'machine'} presence
 * @property {'no'|'file'|'plugin'} governed
 * @property {string} write
 * @property {string[]} evidence
 */

/**
 * @param {string} [projectRoot]
 * @param {object} [options]
 * @returns {HostDetection[]}
 */
export function detectHosts(projectRoot = process.cwd(), options = {}) {
  const io = { ...defaultIo(), ...(options.io || {}) };
  const home = options.home || os.homedir();
  const env = options.env || process.env;
  const detectScope = options.scope || env.GOVERNOR_DETECT || 'all';
  const scanUser = detectScope !== 'project' && options.scanUser !== false;
  const scanPath = detectScope !== 'project' && options.scanPath !== false;
  const flags = { scanUser, scanPath, env };

  return [
    inspectClaude(projectRoot, home, io, flags),
    inspectCursor(projectRoot, home, io, flags),
    inspectCodex(projectRoot, home, io, flags),
    inspectGemini(projectRoot, home, io, flags),
    inspectWindsurf(projectRoot, home, io, flags),
    inspectOpencode(projectRoot, home, io, flags),
  ];
}

export function normalizeHostId(raw) {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  if (!key) {
    return null;
  }
  const mapped = HOST_ALIASES[key];
  if (!mapped) {
    throw new Error(`Unknown host "${raw}". Use: ${HOSTS.join(', ')} (or all).`);
  }
  return mapped;
}

/**
 * Parse --hosts / prompt input.
 * @returns {'all'|string[]}
 */
export function parseHostList(raw) {
  if (raw == null) {
    return null;
  }
  const text = String(raw).trim();
  if (!text) {
    return [];
  }
  if (text === 'all' || text === '*') {
    return 'all';
  }
  const parts = text
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.map((part) => normalizeHostId(part));
}

/**
 * @param {HostDetection[]} detections
 * @param {'all'|string[]|null} requested
 * @returns {string[]}
 */
export function resolveHostsToWire(detections, requested) {
  if (requested == null) {
    return [];
  }
  if (requested === 'all') {
    return detections.filter((row) => row.presence !== 'absent').map((row) => row.id);
  }
  if (!Array.isArray(requested)) {
    return [];
  }
  return [...new Set(requested)];
}

export async function promptHostSelection(detections, { stdin, stdout } = {}) {
  const input = stdin || process.stdin;
  const output = stdout || process.stdout;
  const present = detections.filter((row) => row.presence !== 'absent').map((row) => row.id);
  output.write(
    'Wire which hosts? Comma-separated ids, "all" (detected only), or empty for none.\n'
  );
  if (present.length > 0) {
    output.write(`Detected (present): ${present.join(', ')}\n`);
  }
  output.write('> ');
  const rl = readline.createInterface({ input, output, terminal: Boolean(input.isTTY) });
  try {
    const line = await rl.question('');
    return resolveHostsToWire(detections, parseHostList(line));
  } finally {
    rl.close();
  }
}

export function formatDetectTable(detections) {
  const lines = ['Detected coding agents', ''];
  const idWidth = Math.max(...detections.map((row) => row.id.length), 12);
  for (const row of detections) {
    const presence = row.presence.padEnd(8);
    const governed =
      row.governed === 'no' ? 'not governed' : `governed (${row.governed})`;
    const evidence = row.evidence.length > 0 ? row.evidence.join('; ') : 'not found';
    lines.push(
      `  ${row.id.padEnd(idWidth)}  ${presence}  ${governed.padEnd(20)}  write: ${row.write}`
    );
    lines.push(`  ${''.padEnd(idWidth)}  ${evidence}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
