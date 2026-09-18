import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, toJsonConfig } from './config.js';
import { parseHostList } from './detect-hosts.js';

export const DEFAULT_HOOK_COMMANDS = {
  nodePre: 'npx agent-governor pre-check',
  nodePost: 'npx agent-governor post-check',
  pythonPre: 'python3 .agent-governor/python/pre_tool_use.py',
  pythonPost: 'python3 .agent-governor/python/post_tool_use.py',
  native: 'bash .agent-governor/native/governor_guard.sh',
  sessionStart: 'npx agent-governor session-hook --event SessionStart',
  preCompact: 'npx agent-governor session-hook --event PreCompact',
  readScan: 'npx agent-governor post-check',
};

const WRITE_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit';
const PRE_MATCHER = `${WRITE_MATCHER}|Bash`;
const READ_MATCHER = 'Read|WebFetch|WebSearch';
const SESSION_COMMANDS = {
  sessionStart: 'npx agent-governor session-hook --event SessionStart',
  preCompact: 'npx agent-governor session-hook --event PreCompact',
  readScan: 'npx agent-governor post-check',
};

function commandHook(matcher, command) {
  return {
    matcher,
    hooks: [{ type: 'command', command }],
  };
}

export function hookSettingsFor(langs = ['node']) {
  const selected = new Set(langs.includes('all') ? ['node'] : langs);
  const pythonOnly = selected.size === 1 && selected.has('python');

  const preCommand = pythonOnly ? DEFAULT_HOOK_COMMANDS.pythonPre : DEFAULT_HOOK_COMMANDS.nodePre;
  const postCommand = pythonOnly ? DEFAULT_HOOK_COMMANDS.pythonPost : DEFAULT_HOOK_COMMANDS.nodePost;

  return {
    PreToolUse: [commandHook(PRE_MATCHER, preCommand)],
    PostToolUse: [
      commandHook(WRITE_MATCHER, postCommand),
      // Read-side injection scanning shares the post-check entry point.
      commandHook(READ_MATCHER, SESSION_COMMANDS.readScan),
    ],
    // Context re-injection: rules survive compaction and fresh sessions.
    SessionStart: [commandHook('*', SESSION_COMMANDS.sessionStart)],
    PreCompact: [commandHook('*', SESSION_COMMANDS.preCompact)],
  };
}

/** @deprecated use hookSettingsFor */
export const HOOK_SETTINGS = hookSettingsFor(['node']);

export const EXAMPLE_CONFIG = JSON.stringify(toJsonConfig(CONFIG), null, 2) + '\n';

const PYTHON_MARKERS = ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile'];
const NATIVE_MARKERS = [
  'Cargo.toml',
  'go.mod',
  'CMakeLists.txt',
  'Makefile',
  'pubspec.yaml',
  'Podfile',
  'Package.swift',
  'build.gradle',
  'build.gradle.kts',
];

export function detectLanguages(cwd = process.cwd(), existsSync = fs.existsSync) {
  const langs = [];
  if (existsSync(path.join(cwd, 'package.json'))) {
    langs.push('node');
  }
  if (PYTHON_MARKERS.some((file) => existsSync(path.join(cwd, file)))) {
    langs.push('python');
  }
  if (NATIVE_MARKERS.some((file) => existsSync(path.join(cwd, file)))) {
    langs.push('native');
  }
  return langs.length > 0 ? langs : ['node', 'python', 'native'];
}

/** Parse --preset <name> (aliases: -p). Returns undefined when absent. */
export function parsePresetFlag(argv = []) {
  const index = argv.findIndex((arg) => arg === '--preset' || arg.startsWith('--preset='));
  if (index === -1) {
    return undefined;
  }
  const raw = argv[index].startsWith('--preset=')
    ? argv[index].slice('--preset='.length)
    : argv[index + 1];
  return raw || undefined;
}

export function parseHostsFlag(argv = []) {
  const index = argv.findIndex((arg) => arg === '--hosts' || arg.startsWith('--hosts='));
  if (index === -1) {
    return null;
  }
  const raw = argv[index].startsWith('--hosts=')
    ? argv[index].slice('--hosts='.length)
    : argv[index + 1];
  return parseHostList(raw == null ? '' : raw);
}

export function parseYesFlag(argv = []) {
  return argv.includes('--yes') || argv.includes('-y');
}

export function parseDryRunFlag(argv = []) {
  return argv.includes('--dry-run');
}

export function parseLangFlag(argv = []) {
  const index = argv.findIndex((arg) => arg === '--lang' || arg.startsWith('--lang='));
  if (index === -1) {
    return 'auto';
  }
  const raw = argv[index].startsWith('--lang=')
    ? argv[index].slice('--lang='.length)
    : argv[index + 1];
  const value = (raw || 'auto').toLowerCase();
  if (['auto', 'all', 'node', 'python', 'native'].includes(value)) {
    return value;
  }
  throw new Error(`Unknown --lang value: ${raw}. Use auto|all|node|python|native.`);
}

export function resolveLanguages(lang, cwd, existsSync = fs.existsSync) {
  if (lang === 'auto') {
    return detectLanguages(cwd, existsSync);
  }
  if (lang === 'all') {
    return ['node', 'python', 'native'];
  }
  return [lang];
}

function hasGovernorHook(hooks = [], command) {
  return hooks.some((group) =>
    (group.hooks || []).some((hook) => hook.command === command)
  );
}

export function mergeHookSettings(existing = {}, langs = ['node']) {
  const next = {
    ...existing,
    hooks: {
      ...(existing.hooks || {}),
    },
  };

  const generated = hookSettingsFor(langs);
  for (const [eventName, groups] of Object.entries(generated)) {
    const current = Array.isArray(next.hooks[eventName]) ? [...next.hooks[eventName]] : [];
    for (const group of groups) {
      const command = group.hooks[0].command;
      if (!hasGovernorHook(current, command)) {
        current.push(group);
      }
    }
    next.hooks[eventName] = current;
  }

  return next;
}

export function findPackageRoot(start = process.argv[1]) {
  let dir = path.dirname(path.resolve(start || process.cwd()));
  for (let i = 0; i < 10; i += 1) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (parsed.name === 'agent-governor') {
          return dir;
        }
      } catch {
        // keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  try {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  } catch {
    return process.cwd();
  }
}

function copyRuntimeTree(fromDir, toDir, { mkdirSync, copyFileSync, chmodSync, existsSync }) {
  if (!existsSync(fromDir)) {
    return [];
  }
  mkdirSync(toDir, { recursive: true });
  const created = [];
  for (const entry of fs.readdirSync(fromDir)) {
    const source = path.join(fromDir, entry);
    const target = path.join(toDir, entry);
    const stat = fs.statSync(source);
    if (stat.isDirectory()) {
      created.push(...copyRuntimeTree(source, target, { mkdirSync, copyFileSync, chmodSync, existsSync }));
      continue;
    }
    copyFileSync(source, target);
    if (source.endsWith('.py') || source.endsWith('.sh')) {
      try {
        chmodSync(target, 0o755);
      } catch {
        // Windows may not support chmod
      }
    }
    created.push(target);
  }
  return created;
}

function readJsonFile(filePath, { existsSync, readFileSync }) {
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonFile(filePath, value, writeFileSync) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function loadAdapter(packageRoot, name, readFileSync) {
  return JSON.parse(readFileSync(path.join(packageRoot, 'adapters', name), 'utf8'));
}

/** Merge Claude-style { matcher, hooks: [{ command }] } groups. */
function mergeHookEventMap(existing = {}, incoming = {}) {
  const next = { ...existing };
  for (const [eventName, groups] of Object.entries(incoming)) {
    const current = Array.isArray(next[eventName]) ? [...next[eventName]] : [];
    for (const group of groups) {
      const already = current.some((item) => JSON.stringify(item).includes('agent-governor'));
      if (!already) {
        current.push(group);
      }
    }
    next[eventName] = current;
  }
  return next;
}

function wireClaude({ cwd, langs, fsApi, created }) {
  const { mkdirSync, existsSync, readFileSync, writeFileSync } = fsApi;
  const settingsPath = path.join(cwd, '.claude', 'settings.json');
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  const existing = readJsonFile(settingsPath, fsApi);
  const merged = mergeHookSettings(existing, langs);
  writeJsonFile(settingsPath, merged, writeFileSync);
  created.push(path.relative(cwd, settingsPath));
  return settingsPath;
}

function wireCursor({ cwd, packageRoot, fsApi, created }) {
  const { mkdirSync, existsSync, readFileSync, writeFileSync } = fsApi;
  const hooksPath = path.join(cwd, '.cursor', 'hooks.json');
  mkdirSync(path.dirname(hooksPath), { recursive: true });
  const adapter = loadAdapter(packageRoot, 'cursor-hooks.json', readFileSync);
  const existing = readJsonFile(hooksPath, { existsSync, readFileSync });
  const merged = {
    ...existing,
    ...adapter,
    hooks: mergeHookEventMap(existing.hooks || {}, adapter.hooks || {}),
  };
  if (adapter.version != null) {
    merged.version = existing.version ?? adapter.version;
  }
  writeJsonFile(hooksPath, merged, writeFileSync);
  created.push(path.relative(cwd, hooksPath));
}

function wireCodex({ cwd, home, packageRoot, fsApi, created, detections }) {
  const { mkdirSync, existsSync, readFileSync, writeFileSync } = fsApi;
  const row = detections.find((item) => item.id === 'codex');
  const projectDir = path.join(cwd, '.codex');
  const useProject = row?.presence === 'project' || existsSync(projectDir);
  const target = useProject
    ? path.join(projectDir, 'hooks.json')
    : path.join(home, '.codex', 'hooks.json');
  mkdirSync(path.dirname(target), { recursive: true });
  const adapter = loadAdapter(packageRoot, 'codex-hooks.json', readFileSync);
  const existing = readJsonFile(target, { existsSync, readFileSync });
  const merged = {
    ...existing,
    ...adapter,
    hooks: mergeHookEventMap(existing.hooks || {}, adapter.hooks || {}),
  };
  writeJsonFile(target, merged, writeFileSync);
  created.push(useProject ? path.relative(cwd, target) : target);
}

function wireGemini({ cwd, home, packageRoot, fsApi, created, detections }) {
  const { mkdirSync, existsSync, readFileSync, writeFileSync } = fsApi;
  const row = detections.find((item) => item.id === 'gemini-cli');
  const projectDir = path.join(cwd, '.gemini');
  const useProject = row?.presence === 'project' || existsSync(projectDir);
  const target = useProject
    ? path.join(projectDir, 'settings.json')
    : path.join(home, '.gemini', 'settings.json');
  mkdirSync(path.dirname(target), { recursive: true });
  const adapter = loadAdapter(packageRoot, 'gemini-settings-hooks.json', readFileSync);
  const existing = readJsonFile(target, { existsSync, readFileSync });
  const merged = {
    ...existing,
    hooks: mergeHookEventMap(existing.hooks || {}, adapter.hooks || {}),
  };
  writeJsonFile(target, merged, writeFileSync);
  created.push(useProject ? path.relative(cwd, target) : target);
}

function wireWindsurf({ cwd, home, packageRoot, fsApi, created, detections }) {
  const { mkdirSync, existsSync, readFileSync, writeFileSync } = fsApi;
  const row = detections.find((item) => item.id === 'windsurf');
  const projectDir = path.join(cwd, '.windsurf');
  const useProject = row?.presence === 'project' || existsSync(projectDir);
  const target = useProject
    ? path.join(projectDir, 'hooks.json')
    : path.join(home, '.codeium', 'windsurf', 'hooks.json');
  mkdirSync(path.dirname(target), { recursive: true });
  const adapter = loadAdapter(packageRoot, 'windsurf-hooks.json', readFileSync);
  const existing = readJsonFile(target, { existsSync, readFileSync });
  const merged = {
    ...existing,
    hooks: mergeHookEventMap(existing.hooks || {}, adapter.hooks || {}),
  };
  writeJsonFile(target, merged, writeFileSync);
  created.push(useProject ? path.relative(cwd, target) : target);
}

function wireOpencode({ cwd, packageRoot, fsApi, created }) {
  const { mkdirSync, existsSync, copyFileSync } = fsApi;
  const target = path.join(cwd, '.opencode', 'plugins', 'agent-governor.js');
  mkdirSync(path.dirname(target), { recursive: true });
  if (!existsSync(target)) {
    copyFileSync(path.join(packageRoot, 'adapters', 'opencode-plugin.js'), target);
    created.push(path.relative(cwd, target));
  }
}

export function initProject(
  cwd = process.cwd(),
  {
    writeFileSync = fs.writeFileSync,
    mkdirSync = fs.mkdirSync,
    existsSync = fs.existsSync,
    readFileSync = fs.readFileSync,
    copyFileSync = fs.copyFileSync,
    chmodSync = fs.chmodSync,
    lang = 'auto',
    preset,
    packageRoot = findPackageRoot(),
    hosts = [],
    detections = [],
    home = os.homedir(),
  } = {}
) {
  const langs = resolveLanguages(lang, cwd, existsSync);
  const agentDir = path.join(cwd, '.agent-governor');
  const configPath = path.join(cwd, 'governor.config.json');
  const created = [];
  const selected = new Set(hosts || []);
  const fsApi = { writeFileSync, mkdirSync, existsSync, readFileSync, copyFileSync, chmodSync };

  if (!existsSync(configPath)) {
    // With --preset, write a minimal config referencing the pack instead of
    // the full default rules — full-copy configs would later override preset
    // AST flags (e.g. strict's goForbidPanic: true).
    writeFileSync(
      configPath,
      preset ? `${JSON.stringify({ preset }, null, 2)}\n` : EXAMPLE_CONFIG
    );
    created.push(path.relative(cwd, configPath));
  }

  if (langs.includes('python') || langs.includes('native') || langs.includes('all')) {
    mkdirSync(agentDir, { recursive: true });
  }

  if (langs.includes('python')) {
    const copied = copyRuntimeTree(path.join(packageRoot, 'python'), path.join(agentDir, 'python'), {
      mkdirSync,
      copyFileSync,
      chmodSync,
      existsSync,
    });
    created.push(...copied.map((file) => path.relative(cwd, file)));
  }

  if (langs.includes('native')) {
    const copied = copyRuntimeTree(path.join(packageRoot, 'native'), path.join(agentDir, 'native'), {
      mkdirSync,
      copyFileSync,
      chmodSync,
      existsSync,
    });
    created.push(...copied.map((file) => path.relative(cwd, file)));
  }

  let settingsPath = path.join(cwd, '.claude', 'settings.json');
  if (selected.has('claude-code')) {
    settingsPath = wireClaude({ cwd, langs, fsApi, created });
  }
  if (selected.has('cursor')) {
    wireCursor({ cwd, packageRoot, fsApi, created });
  }
  if (selected.has('codex')) {
    wireCodex({ cwd, home, packageRoot, fsApi, created, detections });
  }
  if (selected.has('gemini-cli')) {
    wireGemini({ cwd, home, packageRoot, fsApi, created, detections });
  }
  if (selected.has('windsurf')) {
    wireWindsurf({ cwd, home, packageRoot, fsApi, created, detections });
  }
  if (selected.has('opencode')) {
    wireOpencode({ cwd, packageRoot, fsApi, created });
  }

  return { settingsPath, configPath, created, langs, hosts: [...selected] };
}
