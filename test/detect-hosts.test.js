import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  detectHosts,
  parseHostList,
  resolveHostsToWire,
  formatDetectTable,
} from '../src/detect-hosts.js';

function tmpLayout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'governor-detect-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  return { root, home };
}

test('detectHosts: empty project and empty home is all absent', () => {
  const { root, home } = tmpLayout();
  const rows = detectHosts(root, { home, scanPath: false, env: { PATH: '' } });
  assert.ok(rows.every((row) => row.presence === 'absent'));
  assert.ok(rows.every((row) => row.governed === 'no'));
});

test('detectHosts: project .claude/settings.json is present-project', () => {
  const { root, home } = tmpLayout();
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{"hooks":{}}\n');
  const claude = detectHosts(root, { home, scanPath: false, env: { PATH: '' } }).find(
    (row) => row.id === 'claude-code'
  );
  assert.equal(claude.presence, 'project');
  assert.equal(claude.governed, 'no');
});

test('detectHosts: governed when settings mention agent-governor', () => {
  const { root, home } = tmpLayout();
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude', 'settings.json'),
    JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: 'npx agent-governor pre-check' }] }] } })
  );
  const claude = detectHosts(root, { home, scanPath: false, env: { PATH: '' } }).find(
    (row) => row.id === 'claude-code'
  );
  assert.equal(claude.governed, 'file');
});

test('detectHosts: empty .cursor dir is not present', () => {
  const { root, home } = tmpLayout();
  fs.mkdirSync(path.join(root, '.cursor'), { recursive: true });
  const cursor = detectHosts(root, { home, scanPath: false, env: { PATH: '' } }).find(
    (row) => row.id === 'cursor'
  );
  assert.equal(cursor.presence, 'absent');
});

test('parseHostList: aliases, all, empty, unknown', () => {
  assert.equal(parseHostList(null), null);
  assert.deepEqual(parseHostList(''), []);
  assert.equal(parseHostList('all'), 'all');
  assert.deepEqual(parseHostList('claude, cursor'), ['claude-code', 'cursor']);
  assert.throws(() => parseHostList('notepad'), /Unknown host/);
});

test('resolveHostsToWire: all is present-only; explicit can create absent hosts', () => {
  const detections = [
    { id: 'claude-code', presence: 'project' },
    { id: 'cursor', presence: 'absent' },
    { id: 'codex', presence: 'user' },
  ];
  assert.deepEqual(resolveHostsToWire(detections, null), []);
  assert.deepEqual(resolveHostsToWire(detections, 'all'), ['claude-code', 'codex']);
  assert.deepEqual(resolveHostsToWire(detections, ['cursor']), ['cursor']);
});

test('formatDetectTable includes write targets', () => {
  const { root, home } = tmpLayout();
  const text = formatDetectTable(detectHosts(root, { home, scanPath: false, env: { PATH: '' } }));
  assert.match(text, /claude-code/);
  assert.match(text, /write:/);
});
