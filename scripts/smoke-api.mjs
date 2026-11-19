import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));

const environment = { ...process.env, PORT: String(port), STORAGE_DRIVER: 'memory' };
const api = spawn(process.execPath, ['apps/api/src/main.ts'], {
  cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'],
});
const exited = once(api, 'exit');
let stderr = '';
api.stderr.on('data', chunk => { stderr += chunk.toString(); });

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('API did not become ready within 10 seconds.')), 10_000);
    let output = '';
    const onExit = () => { clearTimeout(timeout); reject(new Error(`API exited before readiness: ${stderr}`)); };
    api.once('exit', onExit);
    api.once('error', error => { clearTimeout(timeout); reject(error); });
    api.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.includes('Terminal Velocity API:')) {
        clearTimeout(timeout);
        api.off('exit', onExit);
        resolve();
      }
    });
  });
  const health = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(5000) });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { data: { status: 'ok', mode: 'demo', storage: 'memory' } });
  const example = await promisify(execFile)(process.execPath, ['examples/send-demo-message.mjs'], {
    cwd: root, env: environment, timeout: 10_000,
  });
  assert.match(example.stdout, /created: true/);
  assert.match(example.stdout, /created: false/);
  assert.match(example.stdout, /freshness: 'RECENT'/);
  console.log('PASS: executable started, health checked, example created/replayed a message, RECENT confirmed.');
} finally {
  if (api.exitCode === null && api.signalCode === null) api.kill('SIGTERM');
  const deadline = setTimeout(() => api.kill('SIGKILL'), 6000);
  const [code, signal] = await exited;
  clearTimeout(deadline);
  assert.equal(signal, null, `API required forced shutdown: ${signal}`);
  assert.equal(code, 0, stderr);
  console.log('PASS: executable shut down cleanly after SIGTERM.');
}
