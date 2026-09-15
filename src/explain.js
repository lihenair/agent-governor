/**
 * `governor explain "git reset --hard"` — explain what the governor would do
 * with a specific command or file, and why. Complements `explain --config`
 * (which lists the whole compiled rule set).
 */
import { basename } from 'node:path';
import { isProtectedFileName, CONFIG } from './config.js';

const RULE_DOCS = {
  'protected-file':
    'The file is a toolchain manifest (tsconfig, package.json, lockfile...). Editing it can silently weaken the compiler, linter, or dependency tree.',
  'protected-directory':
    'The path is inside agent governance infrastructure (.claude/, .agent-governor/). Agents must not rewrite their own rules.',
  'source-policy':
    'The content contains a forbidden construct (eval, new Function, unsafe block...) per astRules.',
  'forbidden-bash':
    'The command matches a forbiddenBashPatterns regex from the config.',
  'protected-file-bash':
    'The command writes to a protected file through shell redirection or in-place tools (tee, sed -i...).',
  'protected-write-argv':
    'The command passes a protected file path into another program (sh -c, python -c...) as a write target.',
  'process.spawn.dynamic':
    'The command spawns a sub-interpreter (node -e, python -c, bash -c...). The governor cannot inspect what runs inside, so it asks first.',
};

const CAPABILITY_DOCS = {
  'git.push.force': 'Rewrites remote history with --force / -f.',
  'hooks.bypass': 'Skips git hooks with --no-verify.',
  'git.branch.delete': 'Deletes a git branch (-D / --delete).',
  'secret.path.read': 'Touches SSH keys, cloud credentials, .env, or .npmrc.',
  'ci.path.write': 'Writes CI/CD pipelines (.github/workflows, .gitlab-ci.yml).',
};

/**
 * Build a human-readable explanation for one hypothetical tool call.
 *
 * @param {{command?:string, file?:string, operation?:string}} target
 * @param {object} config loaded governor config
 * @param {object} [evaluation] precomputed runDryTest report
 * @returns {string}
 */
export function explainTarget(target, config, evaluation) {
  const lines = [];

  const subject = target.command
    ? `command: ${target.command}`
    : `${target.operation || 'modify'}: ${target.file}`;

  lines.push(`🔎 Agent Governor explain — ${subject}`, '');

  if (!evaluation) {
    lines.push('  (no evaluation available)');
    return lines.join('\n');
  }

  const action = evaluation.decision || (evaluation.exitCode === 2 ? 'deny' : 'allow');
  lines.push(`  decision : ${action.toUpperCase()}`);
  if (evaluation.ruleId) {
    lines.push(`  rule     : ${evaluation.ruleId}`);
  }
  lines.push('');

  // Why: rule-specific rationale.
  const ruleId = evaluation.ruleId || '';
  const doc =
    RULE_DOCS[ruleId] ||
    (ruleId.startsWith('git.') || ruleId.startsWith('hooks.') || ruleId.startsWith('secret.') || ruleId.startsWith('ci.')
      ? CAPABILITY_DOCS[ruleId] || 'Matches a built-in dangerous-capability rule.'
      : null);
  if (doc) {
    lines.push(`  why      : ${doc}`);
  }

  if (action === 'allow') {
    // Give the user the "closest call" info for allow decisions.
    if (target.file) {
      const name = basename(target.file);
      if (isProtectedFileName(name, config)) {
        lines.push(`  note     : "${name}" is in protectedFiles but this shape did not trigger — check the tool shape (read vs write).`);
      } else {
        lines.push(`  note     : "${name}" is not in protectedFiles. Add it to governor.config.json if it should be.`);
      }
    } else {
      lines.push('  note     : no rule matched. If this should be blocked, add a pattern to forbiddenBashPatterns.');
    }
    if (evaluation.suggestion) {
      lines.push(`  tip      : ${evaluation.suggestion}`);
    }
  } else {
    if (evaluation.suggestion) {
      lines.push(`  fix      : ${evaluation.suggestion}`);
    }
    lines.push('  override : add the file to "unprotect" or a pattern exception in governor.config.json if this is a false positive.');
  }

  return lines.join('\n');
}
