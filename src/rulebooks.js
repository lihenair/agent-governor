/**
 * Rulebook loader: installable policy packs that can only ADD protection.
 *
 * A rulebook is a JSON file (local path or installed under
 * `.agent-governor/rulebooks/<name>.json`) with the same shape as a config
 * fragment. By constitution a rulebook may never subtract: `unprotect`,
 * `override`, `injectionMode: "off"`, and `preset` fields are stripped before
 * merging. This mirrors the cc-safety-net rulebook model: packs add blocks;
 * they cannot turn built-in protection off.
 */
import fs from 'node:fs';
import path from 'node:path';

const FORBIDDEN_RULEBOOK_KEYS = new Set([
  'unprotect',
  'override',
  'preset',
  'injectionMode',
  'failureMode',
]);

const ALLOWED_RULEBOOK_KEYS = new Set([
  'protectedFiles',
  'protectedDirectories',
  'forbiddenBashPatterns',
  'injectionPatterns',
  'astRules',
]);

/**
 * Sanitize a rulebook: keep only additive keys.
 *
 * @param {object} raw parsed rulebook JSON
 * @param {string} [name] for error messages
 * @returns {{clean: object, stripped: string[]}}
 */
export function sanitizeRulebook(raw, name = 'rulebook') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${name}: rulebook must be a JSON object`);
  }

  const stripped = Object.keys(raw).filter(
    (key) => FORBIDDEN_RULEBOOK_KEYS.has(key) || !ALLOWED_RULEBOOK_KEYS.has(key)
  );
  const clean = {};
  for (const key of Object.keys(raw)) {
    if (ALLOWED_RULEBOOK_KEYS.has(key)) {
      clean[key] = raw[key];
    }
  }
  return { clean, stripped };
}

/**
 * Load and sanitize a rulebook by name (searches the rulebooks dir) or path.
 *
 * @param {string} ref rulebook name ("terraform") or absolute/relative path
 * @param {string} projectRoot
 */
export function loadRulebook(ref, projectRoot = process.cwd()) {
  const candidates = [];
  if (path.isAbsolute(ref) || ref.includes('/')) {
    candidates.push(path.resolve(projectRoot, ref));
  }
  candidates.push(
    path.join(projectRoot, '.agent-governor', 'rulebooks', `${ref}.json`),
    path.join(projectRoot, 'rulebooks', `${ref}.json`)
  );

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const { clean, stripped } = sanitizeRulebook(raw, path.basename(filePath));
      return { name: path.basename(filePath, '.json'), path: filePath, clean, stripped };
    }
  }

  throw new Error(
    `Rulebook "${ref}" not found. Looked in: ${candidates.join(', ')}. ` +
      `Install official packs or place a JSON file under .agent-governor/rulebooks/.`
  );
}

/**
 * Load several rulebooks and merge into one additive fragment.
 *
 * @param {string[]} refs
 * @param {string} projectRoot
 * @returns {{fragment: object, loaded: Array, allStripped: string[]}}
 */
export function loadRulebooks(refs, projectRoot = process.cwd()) {
  const fragment = { protectedFiles: [], protectedDirectories: [], forbiddenBashPatterns: [], injectionPatterns: [], astRules: {} };
  const loaded = [];
  const allStripped = [];

  for (const ref of refs || []) {
    const rulebook = loadRulebook(ref, projectRoot);
    loaded.push(rulebook.name);
    allStripped.push(...rulebook.stripped.map((key) => `${rulebook.name}:${key}`));
    for (const listKey of ['protectedFiles', 'protectedDirectories', 'forbiddenBashPatterns', 'injectionPatterns']) {
      if (Array.isArray(rulebook.clean[listKey])) {
        fragment[listKey].push(...rulebook.clean[listKey]);
      }
    }
    Object.assign(fragment.astRules, rulebook.clean.astRules || {});
  }

  return { fragment, loaded, allStripped };
}
