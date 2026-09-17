const ARRAY_STRING_KEYS = [
  'protectedFiles',
  'protectedDirectories',
  'codeExtensions',
  'unprotect',
  'rulebooks',
];

/**
 * Minimal config check. No ajv.
 *
 * @param {unknown} config
 * @param {string} file
 * @returns {{ok: boolean, errors: {file: string, path: string, reason: string}[]}}
 */
export function validateGovernorConfig(config, file = 'governor.config.json') {
  const errors = [];

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {
      ok: false,
      errors: [{ file, path: '', reason: 'config must be a JSON object' }],
    };
  }

  const body = /** @type {Record<string, unknown>} */ (config);

  for (const key of ARRAY_STRING_KEYS) {
    if (body[key] === undefined) {
      continue;
    }
    if (!Array.isArray(body[key]) || body[key].some((item) => typeof item !== 'string')) {
      errors.push({ file, path: key, reason: `${key} must be an array of strings` });
    }
  }

  if (body.forbiddenBashPatterns !== undefined && !Array.isArray(body.forbiddenBashPatterns)) {
    errors.push({
      file,
      path: 'forbiddenBashPatterns',
      reason: 'forbiddenBashPatterns must be an array of strings or RegExp',
    });
  }

  if (body.override !== undefined && typeof body.override !== 'boolean') {
    errors.push({ file, path: 'override', reason: 'override must be a boolean' });
  }

  if (body.failureMode !== undefined && body.failureMode !== 'open' && body.failureMode !== 'closed') {
    errors.push({
      file,
      path: 'failureMode',
      reason: 'failureMode must be "open" or "closed"',
    });
  }

  if (body.injectionMode !== undefined && body.injectionMode !== 'scan' && body.injectionMode !== 'off') {
    errors.push({
      file,
      path: 'injectionMode',
      reason: 'injectionMode must be "scan" or "off"',
    });
  }

  if (body.engine !== undefined && body.engine !== 'regex' && body.engine !== 'ast-grep') {
    errors.push({
      file,
      path: 'engine',
      reason: 'engine must be "regex" or "ast-grep"',
    });
  }

  if (body.astRules !== undefined && (typeof body.astRules !== 'object' || Array.isArray(body.astRules))) {
    errors.push({ file, path: 'astRules', reason: 'astRules must be an object' });
  }

  return { ok: errors.length === 0, errors };
}

export function formatValidationErrors(errors) {
  return errors
    .map((error) => `${error.file}: ${error.path || '(root)'} — ${error.reason}`)
    .join('\n');
}
