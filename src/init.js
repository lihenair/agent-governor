import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, toJsonConfig } from './config.js';

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
    packageRoot = findPackageRoot(),
  } = {}
) {
  const langs = resolveLanguages(lang, cwd, existsSync);
  const claudeDir = path.join(cwd, '.claude');
  const agentDir = path.join(cwd, '.agent-governor');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const configPath = path.join(cwd, 'governor.config.json');
  const created = [];

  mkdirSync(claudeDir, { recursive: true });

  let existing = {};
  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch {
      existing = {};
    }
  }

  const merged = mergeHookSettings(existing, langs);
  writeFileSync(settingsPath, `${JSON.stringify(merged, null, 2)}\n`);
  created.push(path.relative(cwd, settingsPath));

  if (!existsSync(configPath)) {
    writeFileSync(configPath, EXAMPLE_CONFIG);
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

  const cursorRuleSource = path.join(packageRoot, 'adapters', 'cursor-rule.mdc');
  if (existsSync(cursorRuleSource)) {
    const cursorDir = path.join(cwd, '.cursor', 'rules');
    mkdirSync(cursorDir, { recursive: true });
    const cursorRulePath = path.join(cursorDir, 'agent-governor.mdc');
    if (!existsSync(cursorRulePath)) {
      copyFileSync(cursorRuleSource, cursorRulePath);
      created.push(path.relative(cwd, cursorRulePath));
    }
  }

  return { settingsPath, configPath, created, langs };
}
