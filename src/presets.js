/**
 * Preset policy packs: one flag, an opinionated baseline.
 *
 * `--preset security-hard` gives a security-conscious repo stricter defaults;
 * `--preset frontend` tunes protection toward web toolchains. Presets compose:
 * user `governor.config.json` always wins over preset values.
 */

// CONFIG is imported lazily via buildPresets() to avoid a circular import
// (config.js imports getPreset from this module).
let CONFIG_REF = null;

/** @param {object} config the governor CONFIG defaults */
export function bindPresetsToConfig(config) {
  CONFIG_REF = config;
}

function baseConfig() {
  if (!CONFIG_REF) {
    // Synchronous side-channel: config.js calls bindPresetsToConfig on load.
    // If missing (standalone use), presets degrade to empty base lists.
    CONFIG_REF = { protectedFiles: [], forbiddenBashPatterns: [], astRules: {} };
  }
  return CONFIG_REF;
}

const SECURITY_EXTRA_FILES = [
  '.github/workflows',
  'Dockerfile',
  'docker-compose.yml',
  '.env',
  '.env.local',
  '.npmrc',
  '.nvmrc',
  'renovate.json',
  'dependabot.yml',
  '.pre-commit-config.yaml',
];

const SECURITY_EXTRA_BASH = [
  // supply-chain discipline
  String.raw`npm\s+(?:install|i|publish)[\s\S]*--force`,
  String.raw`pip\s+install[\s\S]*--break-system-packages`,
  // system mutability
  String.raw`sudo\s+rm\s+-rf\s+/`,
  String.raw`chmod\s+-R\s+777\s+/`,
  String.raw`curl[\s\S]*\|\s*sudo\s+(?:ba)?sh`,
  // history/config tampering
  String.raw`git\s+config\s+(?:--global\s+)?(?:user\.(?:name|email)|core\.hooksPath)`,
  String.raw`git\s+update-index\s+--assume-unchanged`,
];

const FRONTEND_EXTRA_FILES = [
  'vite.config.ts',
  'vite.config.js',
  'next.config.js',
  'next.config.mjs',
  'nuxt.config.ts',
  'svelte.config.js',
  'webpack.config.js',
  'tailwind.config.js',
  'tailwind.config.ts',
  'postcss.config.js',
  'astro.config.mjs',
];

const PYTHON_EXTRA_FILES = [
  'poetry.lock',
  'pdm.lock',
  'uv.lock',
  'conda.yaml',
  'tox.ini',
  '.python-version',
];

function buildPresets() {
  const base = baseConfig();
  return {
  /**
   * security-hard: everything in the default config, plus supply-chain and
   * CI/infra shields. Intended for OSS repos and anything touching prod.
   */
  'security-hard': {
    protectedFiles: [...base.protectedFiles, ...SECURITY_EXTRA_FILES],
    forbiddenBashPatterns: [...base.forbiddenBashPatterns, ...SECURITY_EXTRA_BASH],
    astRules: {
      ...base.astRules,
      goForbidPanic: true, // stricter than default
    },
    injectionMode: 'scan',
  },

  /**
   * frontend: web toolchain manifests (bundler/CSS framework configs).
   */
  frontend: {
    protectedFiles: [...base.protectedFiles, ...FRONTEND_EXTRA_FILES],
  },

  /**
   * python: data/ML toolchain (poetry/pdm/uv lockfiles, tox, conda envs).
   */
  python: {
    protectedFiles: [...base.protectedFiles, ...PYTHON_EXTRA_FILES],
  },

  /**
   * strict: security-hard + zero tolerance AST flags. For agents working on
   * published libraries where any `unsafe {}` or `panic()` is a bug.
   */
  strict: {
    protectedFiles: [
      ...base.protectedFiles,
      ...SECURITY_EXTRA_FILES,
      ...FRONTEND_EXTRA_FILES,
      ...PYTHON_EXTRA_FILES,
    ],
    forbiddenBashPatterns: [...base.forbiddenBashPatterns, ...SECURITY_EXTRA_BASH],
    astRules: {
      ...base.astRules,
      goForbidPanic: true,
      requireErrorBoundary: true,
    },
    injectionMode: 'scan',
  },
  };
}

export const PRESET_NAMES = Object.keys(buildPresets());

export function hasPreset(name) {
  return Object.prototype.hasOwnProperty.call(buildPresets(), name);
}

/**
 * Get the merged config delta for a preset (or comma-separated presets).
 * Returns {} for unknown/empty input so callers can fall through cleanly.
 *
 * @param {string|string[]} [names] preset name or list
 * @returns {object} config fragment to feed through mergeConfig(CONFIG, preset)
 */
export function getPreset(names) {
  if (!names) {
    return {};
  }
  const list = Array.isArray(names)
    ? names
    : String(names)
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);

  if (list.length === 0) {
    return {};
  }
  for (const name of list) {
    if (!hasPreset(name)) {
      throw new Error(`Unknown preset: ${name}. Available: ${PRESET_NAMES.join(', ')}`);
    }
  }

  // Deep-ish merge: arrays concat (dedup later in mergeConfig), astRules last-wins.
  const PRESETS = buildPresets();
  const merged = { protectedFiles: [], forbiddenBashPatterns: [], astRules: {} };
  for (const name of list) {
    const preset = PRESETS[name];
    merged.protectedFiles.push(...(preset.protectedFiles || []));
    merged.forbiddenBashPatterns.push(...(preset.forbiddenBashPatterns || []));
    Object.assign(merged.astRules, preset.astRules || {});
    if (preset.injectionMode) {
      merged.injectionMode = preset.injectionMode;
    }
  }
  return merged;
}
