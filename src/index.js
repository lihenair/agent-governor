export { CONFIG, loadConfig, mergeConfig, toJsonConfig } from './config.js';
export { evaluatePreToolUse, runPreToolUseGuard } from './pre-tool-use.js';
export { evaluatePostToolUse, inspectAST, runPostToolUseGuard } from './post-tool-use.js';
export { inspectSource, languageIdFor } from './inspect.js';
export { computeHashes, ensureSelfProtect, verifyHashes } from './self-protect.js';
export { logDecision } from './audit/logger.js';
export { evaluateHook, runHookGuard } from './dispatch.js';
export {
  detectLanguages,
  initProject,
  mergeHookSettings,
  parseLangFlag,
} from './init.js';

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
 */
