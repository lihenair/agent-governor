/**
 * @typedef {'allow'|'deny'|'ask'} PolicyAction
 */

/**
 * @typedef {object} ToolCallContext
 * @property {string} toolName
 * @property {Record<string, unknown>} [toolInput]
 * @property {string} [projectRoot]
 * @property {string[]} [filePaths]
 * @property {string} [command]
 * @property {{filePath:string, code:string}[]} [snippets]
 */

/**
 * @typedef {object} Rule
 * @property {string} id
 * @property {PolicyAction} action
 * @property {(ctx: ToolCallContext, policy: Policy) => boolean} match
 * @property {string|((ctx: ToolCallContext, policy: Policy) => string)} [reason]
 */

/**
 * @typedef {object} Policy
 * @property {Rule[]} rules
 * @property {PolicyAction} [defaultAction]
 */

const ACTIONS = new Set(['allow', 'deny', 'ask']);

/**
 * Minimal structural check for a Policy. Does not load files or use ajv.
 *
 * @param {unknown} policy
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validatePolicy(policy) {
  if (!policy || typeof policy !== 'object') {
    return { ok: false, errors: ['policy must be an object'] };
  }

  /** @type {Record<string, unknown>} */
  const body = /** @type {Record<string, unknown>} */ (policy);
  /** @type {string[]} */
  const errors = [];

  if (!Array.isArray(body.rules)) {
    errors.push('policy.rules must be an array');
    return { ok: false, errors };
  }

  body.rules.forEach((rule, index) => {
    if (!rule || typeof rule !== 'object') {
      errors.push(`rules[${index}] must be an object`);
      return;
    }

    const item = /** @type {Record<string, unknown>} */ (rule);
    if (typeof item.id !== 'string' || item.id.length === 0) {
      errors.push(`rules[${index}].id is required`);
    }
    if (!ACTIONS.has(/** @type {string} */ (item.action))) {
      errors.push(`rules[${index}].action must be allow|deny|ask`);
    }
    if (typeof item.match !== 'function') {
      errors.push(`rules[${index}].match must be a function`);
    }
  });

  if (body.defaultAction !== undefined && !ACTIONS.has(/** @type {string} */ (body.defaultAction))) {
    errors.push('defaultAction must be allow|deny|ask');
  }

  return { ok: errors.length === 0, errors };
}

export { ACTIONS };
