// Starts the API (tsx watch, port 8787) and the Vite dev server (port 5173, proxies /api) together.
import { spawn } from 'node:child_process';

const procs = [
  ['api', ['run', 'dev:api']],
  ['web', ['run', 'dev:web']],
].map(([name, args]) => {
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { stdio: ['inherit', 'pipe', 'pipe'], env: process.env });
  const prefix = name === 'api' ? '\x1b[35m[api]\x1b[0m ' : '\x1b[36m[web]\x1b[0m ';
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}avsluttet (${code ?? 0})`);
    for (const p of procs) if (p !== child && !p.killed) p.kill('SIGTERM');
    process.exitCode = code ?? 0;
  });
  return child;
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => procs.forEach((p) => p.kill(sig)));
