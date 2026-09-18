export { CONFIG, loadConfig, mergeConfig, toJsonConfig } from './config.js';
export { evaluatePreToolUse, runPreToolUseGuard } from './pre-tool-use.js';
export { evaluate } from './policy/engine.js';
export { validatePolicy } from './policy/schema.js';
export { compilePreToolPolicy } from './policy/rules.js';
export { evaluatePostToolUse, inspectAST, runPostToolUseGuard } from './post-tool-use.js';
export { inspectSource, languageIdFor } from './inspect.js';
export { validateGovernorConfig } from './config-validate.js';
export { parseBash, collectCapabilities } from './parser/bash.js';
export { computeHashes, ensureSelfProtect, verifyHashes } from './self-protect.js';
export { logDecision } from './audit/logger.js';
export { formatAudit, gcAudit, queryAudit } from './audit/query.js';
export { evaluateHook, runHookGuard } from './dispatch.js';
export { buildSessionContext, runSessionHook, summarizeRecentBlocks } from './session-context.js';
export { evaluateReadScan, scanForInjections, extractReadContent, isReadTool } from './read-guard.js';
export { PRESET_NAMES, getPreset, hasPreset } from './presets.js';
export {
  detectLanguages,
  initProject,
  mergeHookSettings,
  parseLangFlag,
  parseHostsFlag,
} from './init.js';
export {
  detectHosts,
  formatDetectTable,
  parseHostList,
  resolveHostsToWire,
} from './detect-hosts.js';

/**
 * @typedef {Object} GovernorAstRules
 * @property {boolean} [noDirectEval]
 * @property {boolean} [noNewFunction]
 * @property {boolean} [requireErrorBoundary]
 * @property {boolean} [rustForbidUnsafe]
 * @property {boolean} [goForbidPanic]
 * @property {boolean} [dartForbidMirrors]
 * @property {boolean} [swiftForbidForceTry]
 * @property {boolean} [kotlinForbidBangBang]
 * @property {boolean} [cppForbidUnsafeC]
 * @property {boolean} [javaForbidRuntimeExec]
 * @property {string[]} [pythonForbiddenCalls]
 * @property {string[]} [pythonDeprecatedImports]
 */

/**
 * @typedef {Object} GovernorConfig
 * @property {string[]} [protectedFiles]
 * @property {string[]} [protectedDirectories]
 * @property {string[]} [codeExtensions]
 * @property {(RegExp|string)[]} [forbiddenBashPatterns]
 * @property {GovernorAstRules} [astRules]
 * @property {'open'|'closed'} [failureMode]
 */
