import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadRulebook, loadRulebooks, sanitizeRulebook } from '../src/rulebooks.js';
import { loadConfig, mergeConfig, CONFIG } from '../src/config.js';

function tmpRepo(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-rulebook-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('rulebooks: sanitize strips subtractive and override keys', () => {
  const { clean, stripped } = sanitizeRulebook({
    protectedFiles: ['x.tf'],
    unprotect: ['tsconfig.json'],
    override: true,
    preset: 'frontend',
    injectionMode: 'off',
    failureMode: 'closed',
    nonsense: 1,
  });
  assert.deepEqual(clean.protectedFiles, ['x.tf']);
  assert.equal(clean.unprotect, undefined);
  assert.equal(clean.override, undefined);
  assert.equal(clean.preset, undefined);
  assert.equal(clean.injectionMode, undefined);
  assert.ok(stripped.includes('unprotect'));
  assert.ok(stripped.includes('override'));
  assert.ok(stripped.includes('injectionMode'));
});

test('rulebooks: load by name from .agent-governor/rulebooks/', (t) => {
  const dir = tmpRepo(t, {
    '.agent-governor/rulebooks/terraform.json': JSON.stringify({
      protectedFiles: ['main.tf'],
      forbiddenBashPatterns: ['terraform\\\\s+destroy'],
    }),
  });
  const rb = loadRulebook('terraform', dir);
  assert.equal(rb.name, 'terraform');
  assert.deepEqual(rb.clean.protectedFiles, ['main.tf']);
});

test('rulebooks: merged config can only get stronger', (t) => {
  const dir = tmpRepo(t, {
    '.agent-governor/rulebooks/terraform.json': JSON.stringify({
      protectedFiles: ['main.tf'],
      unprotect: ['package.json'], // must be ignored
      injectionMode: 'off', // must be ignored
    }),
  });
  return loadConfig(dir).then((config) => {
    // via loadConfig the rulebook is only applied when referenced in config;
    // direct fragment merge check:
    const { fragment } = loadRulebooks(['terraform'], dir);
    const merged = mergeConfig(CONFIG, fragment);
    assert.ok(merged.protectedFiles.includes('main.tf'));
    assert.ok(merged.protectedFiles.includes('package.json'), 'default protection must survive');
    assert.equal(merged.injectionMode, 'scan', 'rulebook cannot turn off injection scanning');
  });
});

test('rulebooks: config rulebooks field wires packs through loadConfig', (t) => {
  const dir = tmpRepo(t, {
    'governor.config.json': JSON.stringify({ rulebooks: ['terraform'] }),
    '.agent-governor/rulebooks/terraform.json': JSON.stringify({
      protectedFiles: ['main.tf'],
      forbiddenBashPatterns: ['terraform\\s+destroy\\b'],
    }),
  });
  return loadConfig(dir).then((config) => {
    assert.ok(config.protectedFiles.includes('main.tf'));
    assert.ok(
      config.forbiddenBashPatterns.some((p) => p.source.includes('terraform\\s+destroy'))
    );
  });
});

test('rulebooks: missing rulebook gives a clear error', (t) => {
  const dir = tmpRepo(t, {
    'governor.config.json': JSON.stringify({ rulebooks: ['does-not-exist'] }),
  });
  return loadConfig(dir).then(
    () => assert.fail('should have thrown'),
    (err) => assert.match(err.message, /Rulebook "does-not-exist" not found/)
  );
});

test('rulebooks: multiple packs compose', (t) => {
  const dir = tmpRepo(t, {
    '.agent-governor/rulebooks/terraform.json': JSON.stringify({ protectedFiles: ['main.tf'] }),
    '.agent-governor/rulebooks/aws.json': JSON.stringify({ protectedFiles: ['creds.backup'] }),
  });
  const { fragment, loaded } = loadRulebooks(['terraform', 'aws'], dir);
  assert.deepEqual(loaded.sort(), ['aws', 'terraform']);
  const merged = mergeConfig(CONFIG, fragment);
  assert.ok(merged.protectedFiles.includes('main.tf'));
  assert.ok(merged.protectedFiles.includes('creds.backup'));
});
