import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PRESET_NAMES, getPreset, hasPreset } from '../src/presets.js';
import { CONFIG, loadConfig, mergeConfig } from '../src/config.js';

test('presets: known pack names are stable API', () => {
  assert.deepEqual([...PRESET_NAMES].sort(), ['frontend', 'python', 'security-hard', 'strict'].sort());
  assert.ok(hasPreset('security-hard'));
  assert.equal(hasPreset('nope'), false);
});

test('presets: security-hard extends defaults with supply-chain shields', () => {
  const preset = getPreset('security-hard');
  const merged = mergeConfig(CONFIG, preset);

  assert.ok(merged.protectedFiles.includes('.env'));
  assert.ok(merged.protectedFiles.includes('Dockerfile'));
  assert.ok(merged.protectedFiles.includes('.github/workflows'));
  assert.ok(merged.protectedFiles.includes('package.json')); // defaults preserved

  const patterns = merged.forbiddenBashPatterns.map((p) => p.source);
  assert.ok(patterns.some((s) => s.includes('npm\\s+(?:install|i|publish)')));
  // defaults preserved
  assert.ok(merged.forbiddenBashPatterns.some((p) => /--no-verify/.test(p.source)));
  assert.equal(merged.astRules.goForbidPanic, true);
});

test('presets: frontend protects bundler configs', () => {
  const merged = mergeConfig(CONFIG, getPreset('frontend'));
  assert.ok(merged.protectedFiles.includes('vite.config.ts'));
  assert.ok(merged.protectedFiles.includes('next.config.js'));
  assert.ok(merged.protectedFiles.includes('tailwind.config.ts'));
});

test('presets: python protects poetry/uv lockfiles', () => {
  const merged = mergeConfig(CONFIG, getPreset('python'));
  assert.ok(merged.protectedFiles.includes('poetry.lock'));
  assert.ok(merged.protectedFiles.includes('uv.lock'));
  assert.ok(merged.protectedFiles.includes('tox.ini'));
});

test('presets: strict is the union of everything + strictest AST flags', () => {
  const merged = mergeConfig(CONFIG, getPreset('strict'));
  assert.ok(merged.protectedFiles.includes('.env'));
  assert.ok(merged.protectedFiles.includes('vite.config.ts'));
  assert.ok(merged.protectedFiles.includes('poetry.lock'));
  assert.equal(merged.astRules.goForbidPanic, true);
  assert.equal(merged.astRules.requireErrorBoundary, true);
});

test('presets: multiple presets compose without duplicates', () => {
  const preset = getPreset('security-hard,frontend');
  const merged = mergeConfig(CONFIG, preset);
  const files = merged.protectedFiles;
  assert.equal(new Set(files).size, files.length, 'protectedFiles must be deduped');
  assert.ok(files.includes('.env') && files.includes('vite.config.ts'));
});

test('presets: unknown preset throws with available names', () => {
  assert.throws(() => getPreset('yolo'), /Unknown preset: yolo/);
});

test('presets: empty preset is a no-op fragment', () => {
  assert.deepEqual(getPreset(''), {});
  assert.deepEqual(getPreset(null), {});
});

test('presets: loadConfig honors GOVERNOR_PRESET env', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-preset-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  process.env.GOVERNOR_PRESET = 'frontend';
  t.after(() => delete process.env.GOVERNOR_PRESET);

  const config = await loadConfig(dir);
  assert.ok(config.protectedFiles.includes('vite.config.ts'));
  assert.ok(config.protectedFiles.includes('package.json'));
});

test('presets: config file preset field wins over env, user file wins over preset', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-preset2-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(dir, 'governor.config.json'),
    JSON.stringify({ preset: 'python', unprotect: ['tsconfig.json'] })
  );

  process.env.GOVERNOR_PRESET = 'frontend';
  t.after(() => delete process.env.GOVERNOR_PRESET);

  const config = await loadConfig(dir);
  // preset field (python) beats env (frontend)
  assert.ok(config.protectedFiles.includes('poetry.lock'));
  assert.equal(config.protectedFiles.includes('vite.config.ts'), false);
  // user file still applies on top: tsconfig.json unprotected
  assert.equal(config.protectedFiles.includes('tsconfig.json'), false);
});
