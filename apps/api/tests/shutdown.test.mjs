import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('SIGTERM closes a listening demo server and exits cleanly', { timeout: 10_000 }, async t => {
  const factory = new URL('../src/create-api-server.ts', import.meta.url).href;
  const shutdown = new URL('../src/runtime/shutdown.ts', import.meta.url).href;
  const script = `
    import { createApiServer } from ${JSON.stringify(factory)};
    import { attachGracefulShutdown } from ${JSON.stringify(shutdown)};
    const server = createApiServer();
    attachGracefulShutdown(server);
    server.listen(0, '127.0.0.1', () => console.log(server.address().port));
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const exited = once(child, 'exit');
  let diagnostic = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => { diagnostic += data; });
  const firstOutput = await Promise.race([
    once(child.stdout, 'data'),
    exited.then(() => { throw new Error(`Server exited before listening: ${diagnostic}`); }),
  ]);
  const port = Number(String(firstOutput[0]).trim());
  assert.ok(Number.isInteger(port) && port > 0);
  const response = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(response.status, 200);
  await response.json();
  child.kill('SIGTERM');
  const [code, signal] = await exited;
  assert.equal(code, 0, diagnostic);
  assert.equal(signal, null);
});
