import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { previewInput, redact } from './redact.js';
import { runFile } from '../run-file.js';

export const AUDIT_MAX_BYTES = 10 * 1024 * 1024;
export const AUDIT_REL = '.agent-governor/audit.log';

function sha256(value) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value ?? {});
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function readBranch(repoRoot) {
  try {
    return runFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function rotateIfNeeded(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const size = fs.statSync(filePath).size;
  if (size <= AUDIT_MAX_BYTES) {
    return;
  }
  const rotated = `${filePath}.1`;
  fs.renameSync(filePath, rotated);
}

/**
 * Append one JSONL decision. Never stores the raw tool input.
 *
 * @param {object} entry
 * @param {{repoRoot?: string, now?: Date}} [options]
 */
export function logDecision(entry, options = {}) {
  const repoRoot = options.repoRoot || entry.cwd || process.cwd();
  const abs = path.join(repoRoot, AUDIT_REL);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  rotateIfNeeded(abs);

  const input = entry.input;
  const record = {
    ts: (options.now || new Date()).toISOString(),
    session: entry.session || '',
    hook: entry.hook || 'PreToolUse',
    tool: entry.tool || '',
    input_hash: entry.input_hash || sha256(input),
    input_preview: entry.input_preview || previewInput(input),
    decision: entry.decision,
    rule_id: entry.rule_id ?? null,
    reason: redact(entry.reason || ''),
    duration_ms: entry.duration_ms ?? 0,
    cwd: entry.cwd || repoRoot,
    branch: entry.branch || readBranch(repoRoot),
    failure_mode: entry.failure_mode || 'open',
  };

  fs.appendFileSync(abs, `${JSON.stringify(record)}\n`);
  return record;
}

export function decisionFromResult(result) {
  if (result?.action === 'allow' || result?.action === 'deny' || result?.action === 'ask') {
    return result.action;
  }
  return result?.exitCode === 2 ? 'deny' : 'allow';
}

/**
 * @param {object} payload
 * @param {object} result
 * @param {{repoRoot: string, hook: string, duration_ms?: number, failure_mode?: string}} meta
 */
export function logGuardDecision(payload, result, meta) {
  try {
    logDecision(
      {
        session: payload?.session_id || payload?.sessionId || '',
        hook: meta.hook,
        tool: payload?.tool_name || '',
        input: payload?.tool_input || {},
        decision: decisionFromResult(result),
        rule_id: result?.ruleId ?? null,
        reason: result?.stderr || result?.reason || '',
        duration_ms: meta.duration_ms ?? 0,
        cwd: meta.repoRoot,
        failure_mode: meta.failure_mode || 'open',
      },
      { repoRoot: meta.repoRoot }
    );
  } catch {
    // Audit must never fail the hook closed.
  }
}
