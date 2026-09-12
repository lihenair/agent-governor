import path from 'node:path';
import { compilePreToolPolicy } from './policy/rules.js';
import { evaluatePreToolUse } from './pre-tool-use.js';

function suggestionFor(report) {
  if (report.ruleId === 'forbidden-bash' && /push[\s\S]*--force/.test(report.reason || '')) {
    return 'Push a feature branch and open a pull request instead of force-pushing protected branches.';
  }
  if (report.ruleId === 'protected-file' || report.ruleId === 'protected-file-bash') {
    return 'Fix the underlying source or tests. Do not weaken compiler, linter, or package config.';
  }
  if (report.ruleId === 'protected-directory') {
    return 'Leave .claude/ and .agent-governor/ alone; change application code instead.';
  }
  if (report.ruleId === 'source-policy') {
    return 'Rewrite the snippet to remove eval/exec/unsafe constructs before the tool runs.';
  }
  if (report.decision === 'deny' || report.decision === 'ask') {
    return 'Adjust the command or file target so it no longer matches a deny rule.';
  }
  return null;
}

export function payloadFromTestFlags(flags, projectRoot) {
  if (flags.command) {
    return { tool_name: 'Bash', tool_input: { command: flags.command } };
  }

  if (!flags.file) {
    throw new Error('test requires --command or --file');
  }

  const operation = flags.operation || 'modify';
  const abs = path.isAbsolute(flags.file) ? flags.file : path.resolve(projectRoot, flags.file);
  if (operation === 'write' || operation === 'create') {
    return { tool_name: 'Write', tool_input: { file_path: abs, content: '' } };
  }
  return {
    tool_name: 'Edit',
    tool_input: { file_path: abs, old_string: '', new_string: '' },
  };
}

export function runDryTest(flags, { config, projectRoot } = {}) {
  const root = projectRoot || process.cwd();
  const payload = payloadFromTestFlags(flags, root);
  const result = evaluatePreToolUse(payload, config, root);
  const decision = result.action || (result.exitCode === 2 ? 'deny' : 'allow');
  const report = {
    decision,
    ruleId: result.ruleId ?? null,
    reason: result.stderr || result.reason || 'allowed',
    exitCode: result.exitCode,
    suggestion: null,
  };
  report.suggestion = suggestionFor(report);
  return report;
}

export function formatTestReport(report, { json = false } = {}) {
  if (json) {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  const lines = [
    `decision: ${report.decision}`,
    `ruleId: ${report.ruleId ?? 'null'}`,
    `reason: ${report.reason}`,
  ];
  if (report.suggestion) {
    lines.push(`suggestion: ${report.suggestion}`);
  }
  return `${lines.join('\n')}\n`;
}

export function explainConfig(config) {
  const policy = compilePreToolPolicy(config);
  const lines = [
    `defaultAction: ${policy.defaultAction}`,
    `rules (${policy.rules.length}):`,
    ...policy.rules.map((rule) => `  - ${rule.id} [${rule.action}]`),
    `protectedFiles: ${(config.protectedFiles || []).length}`,
    `protectedDirectories: ${(config.protectedDirectories || []).join(', ')}`,
    `forbiddenBashPatterns: ${(config.forbiddenBashPatterns || []).length}`,
  ];
  return `${lines.join('\n')}\n`;
}
