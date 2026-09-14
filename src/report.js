/**
 * `governor report` — aggregate the audit log into a human-readable digest.
 *
 * Answers the three questions a maintainer actually has:
 *   1. How many times did the governor intervene? (and when was the last?)
 *   2. Which rules fire the most? (agent's favorite sins)
 *   3. What did it block most recently? (spot-check the reasoning)
 */
import fs from 'node:fs';
import path from 'node:path';
import { AUDIT_REL } from './audit/logger.js';

function loadEntries(projectRoot, limit) {
  const logPath = path.join(projectRoot, AUDIT_REL);
  let raw = '';
  try {
    raw = fs.readFileSync(logPath, 'utf8');
  } catch {
    return [];
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
  return limit ? entries.slice(-limit) : entries;
}

function countBy(list, keyOf) {
  const counts = new Map();
  for (const item of list) {
    const key = keyOf(item);
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function relativeTime(iso) {
  const then = Date.parse(iso || '');
  if (Number.isNaN(then)) {
    return iso || 'unknown';
  }
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Aggregate audit entries into a report object.
 *
 * @param {string} projectRoot
 * @param {{tail?: number}} [options]
 */
export function buildReport(projectRoot = process.cwd(), options = {}) {
  const tail = options.tail || 500;
  const entries = loadEntries(projectRoot, tail);

  const decisions = entries.filter((entry) => entry && entry.decision);
  const blocks = decisions.filter(
    (entry) => entry.decision === 'block' || entry.decision === 'deny' || entry.exitCode === 2
  );
  const byRule = countBy(blocks, (entry) => entry.rule_id || entry.ruleId || entry.rule || 'unknown');
  const byHook = countBy(decisions, (entry) => entry.hook || null);
  const lastBlock = blocks[blocks.length - 1] || null;

  return {
    generatedAt: new Date().toISOString(),
    scannedEntries: entries.length,
    totalDecisions: decisions.length,
    totalBlocks: blocks.length,
    blockRate: decisions.length ? Number((blocks.length / decisions.length).toFixed(3)) : 0,
    byRule: Object.fromEntries(byRule),
    byHook: Object.fromEntries(byHook),
    lastBlock: lastBlock
      ? {
          at: relativeTime(lastBlock.ts || lastBlock.timestamp || lastBlock.time),
          ruleId: lastBlock.rule_id || lastBlock.ruleId || lastBlock.rule || 'unknown',
          tool: lastBlock.tool || lastBlock.toolName || null,
          summary: String(
            (lastBlock.input_preview || lastBlock.preview || lastBlock.reason || '')
          ).slice(0, 120),
        }
      : null,
  };
}

/**
 * Render a report object as a terminal-friendly digest.
 */
export function formatReport(report) {
  const lines = [
    '🛡️ Agent Governor — Audit Report',
    `   generated: ${report.generatedAt}`,
    `   entries scanned: ${report.scannedEntries} (decisions: ${report.totalDecisions})`,
    '',
    `   total blocks : ${report.totalBlocks}`,
    `   block rate   : ${report.blockRate}`,
  ];

  const rules = Object.entries(report.byRule);
  if (rules.length > 0) {
    lines.push('', '   top triggered rules:');
    for (const [rule, count] of rules.slice(0, 8)) {
      lines.push(`     ${String(rule).padEnd(28)} ×${count}`);
    }
  }

  if (Object.keys(report.byHook || {}).length > 0) {
    lines.push('', '   by hook:');
    for (const [hook, count] of Object.entries(report.byHook)) {
      lines.push(`     ${String(hook).padEnd(28)} ×${count}`);
    }
  }

  lines.push('', '   last block:');
  if (report.lastBlock) {
    lines.push(
      `     when : ${report.lastBlock.at}`,
      `     rule : ${report.lastBlock.ruleId}`,
      `     tool : ${report.lastBlock.tool || 'n/a'}`,
      `     what : ${report.lastBlock.summary || 'n/a'}`
    );
  } else {
    lines.push('     nothing blocked yet — the agent has been behaving. 🎉');
  }

  return `${lines.join('\n')}\n`;
}
