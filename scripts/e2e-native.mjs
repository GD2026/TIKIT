// Builds the iOS web bundle against a test API and serves it from its own origin, for the `ios-web` Playwright
// project. The bundle then talks to the API cross-origin with a bearer token – exactly like the iOS app does
// from capacitor://localhost – so CORS, token handling, links and the payment return are tested in Chromium.
// Usage: node scripts/e2e-native.mjs <port> <api-port>
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2] ?? 8902);
const apiPort = Number(process.argv[3] ?? 8901);
const outDir = 'dist/native-e2e';

execSync(`npx vite build --mode native --outDir ${outDir}`, {
  stdio: 'inherit',
  env: { ...process.env, VITE_API_ORIGIN: `http://localhost:${apiPort}` },
});

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
const root = path.resolve(outDir);

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(root, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(port, () => console.log(`iOS-bygget kjører på http://localhost:${port} mot API på ${apiPort}`));
