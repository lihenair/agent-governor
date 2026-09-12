/** @type {import('agent-governor').GovernorConfig} */
module.exports = {
  protectedFiles: [
    'tsconfig.json',
    'biome.json',
    'package.json',
    'pnpm-lock.yaml',
  ],

  forbiddenBashPatterns: [
    /git commit.*--no-verify/i,
    /npm set strict-ssl false/i,
    /rm -rf \.git/i,
  ],

  astRules: {
    noDirectEval: true,
    noNewFunction: true,
    requireErrorBoundary: true,
  },
};
