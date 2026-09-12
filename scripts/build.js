import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, '..');
const outdir = path.join(repoRoot, 'dist');

fs.mkdirSync(outdir, { recursive: true });

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  legalComments: 'none',
  logLevel: 'info',
};

const outputs = [
  ['src/pre-tool-use.js', 'pre-tool-use.js'],
  ['src/post-tool-use.js', 'post-tool-use.js'],
  ['bin/governor.js', 'governor.js'],
];

await Promise.all(
  outputs.map(([entry, file]) =>
    esbuild.build({
      ...shared,
      entryPoints: [path.join(repoRoot, entry)],
      outfile: path.join(outdir, file),
    })
  )
);

for (const [, file] of outputs) {
  const filePath = path.join(outdir, file);
  const source = fs.readFileSync(filePath, 'utf8');
  const withShebang = source.startsWith('#!') ? source : `#!/usr/bin/env node\n${source}`;
  fs.writeFileSync(filePath, withShebang);
  fs.chmodSync(filePath, 0o755);
}

fs.writeFileSync(
  path.join(outdir, 'package.json'),
  `${JSON.stringify({ type: 'commonjs', private: true }, null, 2)}\n`
);

process.stdout.write(`[agent-governor] bundled into ${path.relative(repoRoot, outdir)}\n`);
