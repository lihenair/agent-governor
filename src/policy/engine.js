/**
 * Pure three-state policy evaluator. No filesystem or process IO.
 *
 * @param {import('./schema.js').ToolCallContext} ctx
 * @param {import('./schema.js').Policy} policy
 * @returns {{action:'allow'|'deny'|'ask', reason:string, ruleId:string|null}}
 */
export function evaluate(ctx, policy) {
  const rules = policy?.rules || [];

  for (const rule of rules) {
    if (!rule?.match?.(ctx, policy)) {
      continue;
    }

    return {
      action: rule.action,
      reason: resolveReason(rule, ctx, policy),
      ruleId: rule.id ?? null,
    };
  }

  return {
    action: policy?.defaultAction || 'allow',
    reason: 'no matching rule',
    ruleId: null,
  };
}

function resolveReason(rule, ctx, policy) {
  if (typeof rule.reason === 'function') {
    return rule.reason(ctx, policy);
  }
  return rule.reason || '';
}
