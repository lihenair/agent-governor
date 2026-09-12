export { CONFIG, loadConfig, mergeConfig, toJsonConfig } from './config.js';
export { evaluatePreToolUse, runPreToolUseGuard } from './pre-tool-use.js';
export { evaluatePostToolUse, inspectAST, runPostToolUseGuard } from './post-tool-use.js';
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
 * @property {string[]} [forbiddenCallNames]
 * @property {string[]} [forbiddenIdentifiers]
 */

/**
 * @typedef {Object} GovernorConfig
 * @property {string[]} [protectedFiles]
 * @property {string[]} [protectedDirectories]
 * @property {string[]} [codeExtensions]
 * @property {(RegExp|string)[]} [forbiddenBashPatterns]
 * @property {GovernorAstRules} [astRules]
 */
