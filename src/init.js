import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_HOOK_COMMANDS = {
  pre: 'npx agent-governor pre-check',
  post: 'npx agent-governor post-check',
};

export const HOOK_SETTINGS = {
  PreToolUse: [
    {
      matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash',
      hooks: [
        {
          type: 'command',
          command: DEFAULT_HOOK_COMMANDS.pre,
        },
      ],
    },
  ],
  PostToolUse: [
    {
      matcher: 'Edit|Write|MultiEdit|NotebookEdit',
      hooks: [
        {
          type: 'command',
          command: DEFAULT_HOOK_COMMANDS.post,
        },
      ],
    },
  ],
};

export const EXAMPLE_CONFIG = `/** @type {import('agent-governor').GovernorConfig} */
module.exports = {
  // Config files that Agents are NEVER allowed to edit
  protectedFiles: [
    'tsconfig.json',
    'biome.json',
    'package.json',
    'pnpm-lock.yaml',
  ],

  // Dangerous bash commands to block
  forbiddenBashPatterns: [
    /git commit.*--no-verify/i,
    /npm set strict-ssl false/i,
    /rm -rf \\.git/i,
  ],

  // Custom AST checks
  astRules: {
    noDirectEval: true,
    noNewFunction: true,
    requireErrorBoundary: true,
  },
};
`;

function hasGovernorHook(hooks = [], command) {
  return hooks.some((group) =>
    (group.hooks || []).some((hook) => hook.command === command)
  );
}

export function mergeHookSettings(existing = {}) {
  const next = {
    ...existing,
    hooks: {
      ...(existing.hooks || {}),
    },
  };

  for (const [eventName, groups] of Object.entries(HOOK_SETTINGS)) {
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

export function initProject(cwd = process.cwd(), { writeFileSync = fs.writeFileSync, mkdirSync = fs.mkdirSync, existsSync = fs.existsSync, readFileSync = fs.readFileSync } = {}) {
  const claudeDir = path.join(cwd, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const configPath = path.join(cwd, 'governor.config.cjs');
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

  const merged = mergeHookSettings(existing);
  writeFileSync(settingsPath, `${JSON.stringify(merged, null, 2)}\n`);
  created.push(path.relative(cwd, settingsPath));

  if (!existsSync(configPath)) {
    writeFileSync(configPath, EXAMPLE_CONFIG);
    created.push(path.relative(cwd, configPath));
  }

  return { settingsPath, configPath, created };
}
