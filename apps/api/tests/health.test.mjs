import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApiServer } from '../src/create-api-server.ts';

test('PostgreSQL readiness reports unavailable storage as HTTP 503', async t => {
  let healthy = true;
  const server = createApiServer(undefined, async () => ({ status: healthy ? 'ok' : 'unavailable', mode: 'demo', storage: 'postgres' }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/healthz`;
  let response = await fetch(url);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { status: 'ok', mode: 'demo', storage: 'postgres' } });
  healthy = false;
  response = await fetch(url);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { data: { status: 'unavailable', mode: 'demo', storage: 'postgres' } });
});
