import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

for (const hangs of [false, true]) test(`shutdown ${hangs ? 'enforces its deadline when a resource stays open' : 'waits for asynchronous resource cleanup'}`, { timeout: 5_000 }, async t => {
  const factory = new URL('../src/create-api-server.ts', import.meta.url).href;
  const shutdown = new URL('../src/runtime/shutdown.ts', import.meta.url).href;
  const script = `
    import { createApiServer } from ${JSON.stringify(factory)};
    import { attachGracefulShutdown } from ${JSON.stringify(shutdown)};
    const server = createApiServer();
    const resource = setInterval(() => {}, 10_000);
    attachGracefulShutdown(server, 250, async () => {
      if (${hangs}) return new Promise(() => {});
      await new Promise(resolve => setTimeout(resolve, 30));
      clearInterval(resource);
      console.log('resources closed');
    });
    server.listen(0, '127.0.0.1', () => console.log('ready'));
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  await Promise.race([once(child.stdout, 'data'), exited.then(() => { throw new Error('Child exited before readiness.'); })]);
  child.kill('SIGTERM');
  const [code, signal] = await exited;
  assert.equal(signal, null);
  assert.equal(code, hangs ? 1 : 0);
  if (!hangs) assert.match(output, /resources closed/);
});
