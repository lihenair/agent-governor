import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('loads governor.config.cjs and merges with defaults', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-cfg-'));
    fs.writeFileSync(
      path.join(tmp, 'governor.config.cjs'),
      `module.exports = {
        protectedFiles: ['secret.toml'],
        astRules: { noDirectEval: false, forbiddenCallNames: ['pleaseNo'] },
      };`
    );

    const config = await loadConfig(tmp);
    assert.ok(config.protectedFiles.includes('tsconfig.json'));
    assert.ok(config.protectedFiles.includes('secret.toml'));
    assert.equal(config.astRules.noDirectEval, false);
    assert.deepEqual(config.astRules.forbiddenCallNames, ['pleaseNo']);
  });

  it('returns defaults when no config file exists', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-empty-'));
    const config = await loadConfig(tmp);
    assert.ok(config.protectedFiles.includes('package.json'));
  });
});
