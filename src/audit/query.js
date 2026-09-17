import fs from 'node:fs';
import path from 'node:path';
import { AUDIT_REL } from './logger.js';

const UNIT_MS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/**
 * Parse a relative duration like `24h` or `30d` into a cutoff Date (now - duration).
 *
 * @param {string} spec
 * @param {Date} [now]
 * @returns {Date}
 */
export function parseDuration(spec, now = new Date()) {
  const match = String(spec || '').trim().match(/^(\d+)\s*([smhd])$/i);
  if (!match) {
    throw new Error(`invalid duration "${spec}" (use Ns/Nm/Nh/Nd, e.g. 24h or 30d)`);
  }
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  return new Date(now.getTime() - amount * UNIT_MS[unit]);
}

function auditPaths(projectRoot) {
  return [
    path.join(projectRoot, `${AUDIT_REL}.1`),
    path.join(projectRoot, AUDIT_REL),
  ];
}

function loadFile(filePath) {
  let raw = '';
  try {
    raw = fs.readFileSync(filePath, 'utf8');
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
  return entries;
}

function entryTime(entry) {
  return Date.parse(entry?.ts || entry?.timestamp || entry?.time || '');
}

function decisionMatches(entry, wanted) {
  if (!wanted) {
    return true;
  }
  const actual = String(entry.decision || '').toLowerCase();
  const want = String(wanted).toLowerCase();
  if (want === 'deny' || want === 'block') {
    return actual === 'deny' || actual === 'block';
  }
  return actual === want;
}

function ruleMatches(entry, wanted) {
  if (!wanted) {
    return true;
  }
  const actual = entry.rule_id || entry.ruleId || entry.rule || '';
  return String(actual) === String(wanted);
}

/**
 * Query JSONL audit records with AND filters.
 *
 * @param {string} projectRoot
 * @param {{since?: string, decision?: string, rule?: string, session?: string, now?: Date}} [options]
 * @returns {object[]}
 */
export function queryAudit(projectRoot, options = {}) {
  const now = options.now || new Date();
  const sinceAt = options.since ? parseDuration(options.since, now).getTime() : null;
  const rows = [];
  for (const filePath of auditPaths(projectRoot)) {
    for (const entry of loadFile(filePath)) {
      const ts = entryTime(entry);
      if (sinceAt !== null && (Number.isNaN(ts) || ts < sinceAt)) {
        continue;
      }
      if (!decisionMatches(entry, options.decision)) {
        continue;
      }
      if (!ruleMatches(entry, options.rule)) {
        continue;
      }
      if (options.session && String(entry.session || '') !== String(options.session)) {
        continue;
      }
      rows.push(entry);
    }
  }
  return rows.sort((a, b) => {
    const left = entryTime(a);
    const right = entryTime(b);
    return (Number.isNaN(left) ? 0 : left) - (Number.isNaN(right) ? 0 : right);
  });
}

function pad(value, width) {
  const text = String(value ?? '');
  return text.length >= width ? `${text} ` : text.padEnd(width);
}

/**
 * @param {object[]} entries
 * @param {'table'|'json'} [format]
 */
export function formatAudit(entries, format = 'table') {
  if (format === 'json') {
    return `${JSON.stringify(entries, null, 2)}\n`;
  }
  if (entries.length === 0) {
    return '(no matching audit entries)\n';
  }
  const lines = [`${pad('ts', 25)}${pad('decision', 10)}${pad('rule_id', 22)}${pad('session', 14)}tool`];
  for (const entry of entries) {
    lines.push(
      `${pad(entry.ts || '', 25)}${pad(entry.decision || '', 10)}${pad(
        entry.rule_id || entry.ruleId || '',
        22
      )}${pad(entry.session || '', 14)}${entry.tool || ''}`
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Drop audit entries older than a relative duration. Rewrites audit.log
 * (and audit.log.1 when present).
 *
 * @param {string} projectRoot
 * @param {{olderThan: string, now?: Date}} options
 * @returns {{removed: number, kept: number}}
 */
export function gcAudit(projectRoot, options) {
  const cutoff = parseDuration(options.olderThan, options.now || new Date()).getTime();
  let removed = 0;
  let kept = 0;

  for (const filePath of auditPaths(projectRoot)) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const keep = [];
    for (const entry of loadFile(filePath)) {
      const ts = entryTime(entry);
      if (!Number.isNaN(ts) && ts < cutoff) {
        removed += 1;
      } else {
        keep.push(entry);
        kept += 1;
      }
    }
    const rotated = filePath.endsWith('.1');
    if (rotated && keep.length === 0) {
      fs.unlinkSync(filePath);
      continue;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, keep.length ? `${keep.map((entry) => JSON.stringify(entry)).join('\n')}\n` : '');
  }

  return { removed, kept };
}
