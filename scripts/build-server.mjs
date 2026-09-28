// Bundles the Node server into dist/server/main.js. npm packages stay external (installed at runtime).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/node/main.ts'],
  outfile: 'dist/server/main.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
});
