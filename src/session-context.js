/**
 * SessionStart / PreCompact rule re-injection for Claude Code.
 *
 * Claude Code wipes conversation context on session start and on context
 * compaction. Prose rules pasted into CLAUDE.md may survive, but any runtime
 * governance state (which policies are active, recent blocks, reminder that
 * the governor is watching) does not. This module emits a stdout context blob
 * that Claude Code injects into the fresh context, so agents cannot use a
 * compaction boundary to "forget" the guardrails.
 *
 * Exit code is always 0: SessionStart/PreCompact hooks add stdout to context,
 * they cannot block. A governor crash here must never break the session.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { compilePreToolPolicy } from './policy/rules.js';

export const SESSION_HOOK_EVENTS = new Set(['SessionStart', 'PreCompact']);

async function loadConfigMaybe(cwd) {
  try {
    return await loadConfig(cwd);
  } catch {
    return null;
  }
}

function countBy(list, keyOf) {
  const counts = new Map();
  for (const item of list || []) {
    const key = keyOf(item);
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/**
 * Summarize recent blocks from the audit log (JSON-lines).
 *
 * @param {string} projectRoot
 * @param {number} limit max entries scanned (oldest dropped first by rotation)
 * @returns {{total:number, byRule:Record<string,number>, lastAt:string|null}}
 */
export function summarizeRecentBlocks(projectRoot, limit = 200) {
  const logPath = path.join(projectRoot, '.agent-governor', 'audit.log');
  let raw = '';
  try {
    raw = fs.readFileSync(logPath, 'utf8');
  } catch {
    return { total: 0, byRule: {}, lastAt: null };
  }

  const entries = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines
    }
  }

  const blocks = entries
    .slice(-limit)
    .filter((entry) => entry && (entry.decision === 'block' || entry.exitCode === 2));

  const byRule = countBy(blocks, (entry) => entry.ruleId || entry.rule || null);
  const last = blocks[blocks.length - 1];

  return {
    total: blocks.length,
    byRule: Object.fromEntries(byRule),
    lastAt: last?.timestamp || last?.time || (last ? String(last) : null) || null,
  };
}

function formatByRule(byRule) {
  return Object.entries(byRule || {})
    .map(([rule, count]) => `${rule}×${count}`)
    .join(', ');
}

/**
 * Build the context injection text for SessionStart / PreCompact events.
 *
 * @param {object} [options]
 * @param {string} [options.event] hook_event_name
 * @param {string} [options.projectRoot]
 * @param {object} [options.config] preloaded governor config
 * @param {{total:number, byRule:Record<string,number>, lastAt:string|null}} [options.blocks]
 * @param {number} [options.maxChars] hard budget guard (Claude context is precious)
 * @returns {Promise<{exitCode:number, stdout:string}>|{exitCode:number, stdout:string}}
 */
export async function buildSessionContext({
  event = 'SessionStart',
  projectRoot = process.cwd(),
  config,
  blocks,
  maxChars = 2000,
} = {}) {
  let cfg = config;
  if (!cfg) {
    cfg = await loadConfigMaybe(projectRoot);
  }

  const policy = cfg ? compilePreToolPolicy(cfg) : null;
  const ruleCount = policy ? policy.rules.length : 0;
  const protectedCount = cfg ? (cfg.protectedFiles || []).length : 0;
  const dirCount = cfg ? (cfg.protectedDirectories || []).length : 0;
  const bashCount = cfg ? (cfg.forbiddenBashPatterns || []).length : 0;
  const astRules = Object.entries((cfg && cfg.astRules) || {}).filter(([, v]) => v === true);

  const stats = blocks || summarizeRecentBlocks(projectRoot);

  const lines = [
    `[Agent Governor active — ${event} re-injection]`,
    `Deterministic guardrails are enforced on every Edit/Write/Bash regardless of this context:`,
    `- Policy rules compiled: ${ruleCount}`,
    `- Protected files: ${protectedCount} (configs/lockfiles), protected dirs: ${dirCount}`,
    `- Forbidden bash patterns: ${bashCount}; AST/source rules on: ${astRules.length}`,
    stats.total > 0
      ? `- Recent blocks this repo: ${stats.total}${
          formatByRule(stats.byRule) ? ` (${formatByRule(stats.byRule)})` : ''
        }`
      : `- Recent blocks this repo: 0`,
    `Do not attempt to edit tsconfig/eslint/package manifests or governor files to bypass failures;`,
    `fix the underlying code. The governor cannot be disabled from inside the session.`,
  ];

  let stdout = lines.join('\n');
  if (stdout.length > maxChars) {
    stdout = `${stdout.slice(0, maxChars - 1)}…`;
  }

  return { exitCode: 0, stdout };
}

/**
 * Entry used by the `session-hook` CLI command.
 *
 * @param {{event?:string, projectRoot?:string}} [options]
 */
export async function runSessionHook(options = {}) {
  const event = options.event || 'SessionStart';
  const projectRoot = options.projectRoot || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    return await buildSessionContext({ event, projectRoot });
  } catch (err) {
    // Never break the session loop.
    return {
      exitCode: 0,
      stdout: `[Agent Governor] ${event}: re-injection skipped (${err.message}).`,
    };
  }
}
