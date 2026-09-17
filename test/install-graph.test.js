import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const pkg = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')
);

const LANG_PACKS = [
  '@ast-grep/lang-c',
  '@ast-grep/lang-cpp',
  '@ast-grep/lang-csharp',
  '@ast-grep/lang-dart',
  '@ast-grep/lang-go',
  '@ast-grep/lang-java',
  '@ast-grep/lang-kotlin',
  '@ast-grep/lang-php',
  '@ast-grep/lang-ruby',
  '@ast-grep/lang-rust',
  '@ast-grep/lang-swift',
];

describe('install graph (default npm i)', () => {
  it('does not pull ast-grep lang packs or napi as default/optional deps', () => {
    const optional = Object.keys(pkg.optionalDependencies || {});
    const runtime = Object.keys(pkg.dependencies || {});
    for (const name of [...LANG_PACKS, '@ast-grep/napi']) {
      assert.equal(optional.includes(name), false, `${name} must not be optionalDependencies`);
      assert.equal(runtime.includes(name), false, `${name} must not be dependencies`);
    }
    assert.equal(optional.length, 0, 'no optionalDependencies — npm installs those by default');
  });

  it('keeps napi as an optional peer and test-only lang packs as devDependencies', () => {
    assert.equal(pkg.peerDependencies['@ast-grep/napi'], '^0.45.3');
    assert.equal(pkg.peerDependenciesMeta['@ast-grep/napi'].optional, true);
    assert.ok(pkg.devDependencies['@ast-grep/napi']);
    for (const needed of [
      '@ast-grep/lang-rust',
      '@ast-grep/lang-go',
      '@ast-grep/lang-kotlin',
      '@ast-grep/lang-swift',
      '@ast-grep/lang-c',
      '@ast-grep/lang-cpp',
      '@ast-grep/lang-java',
      '@ast-grep/lang-dart',
    ]) {
      assert.ok(pkg.devDependencies[needed], `devDependency missing: ${needed}`);
    }
    for (const unused of ['@ast-grep/lang-csharp', '@ast-grep/lang-php', '@ast-grep/lang-ruby']) {
      assert.equal(Boolean(pkg.devDependencies[unused]), false, `${unused} is unused and must not be installed`);
    }
  });

  it('still ships @babel/parser as the only runtime dep', () => {
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@babel/parser']);
  });
});
