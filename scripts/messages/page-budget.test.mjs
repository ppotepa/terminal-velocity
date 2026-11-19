import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { boundPage } from './page-budget.mjs';

const url = 'https://app.airframes.io/messages/live';

async function fixture() {
  const context = new EventEmitter(), session = new EventEmitter();
  const failures = [];
  let intercept;
  context.route = async (_, handler) => { intercept = handler; };
  context.newCDPSession = async () => session;
  session.send = async (command, params) => {
    if (command === 'Network.enable') return;
    assert.equal(command, 'Network.setBlockedURLs');
    assert.deepEqual(params, { urlPatterns: [{ urlPattern: 'https://app.airframes.io/*', block: false }],
      urls: ['http://*', 'https://*'] });
  };
  await boundPage(context, {}, url, failure => failures.push(failure));
  async function request(href, navigation = false, method = 'GET') {
    const req = { url: () => href, method: () => method, isNavigationRequest: () => navigation };
    let decision;
    await intercept({ request: () => req, abort: async () => { decision = 'blocked'; },
      fallback: async () => { decision = 'allowed'; } });
    return { decision, finish: () => context.emit('requestfinished', req) };
  }
  return { failures, session, request };
}

test('browser budget permits one scoped navigation and bounds both concurrent and total requests', async () => {
  const { failures, request } = await fixture();
  const first = await request(url, true);
  assert.equal(first.decision, 'allowed');
  first.finish();
  assert.equal((await request(url, true)).decision, 'blocked');
  assert.equal((await request('https://elsewhere.invalid/script')).decision, 'blocked');
  assert.equal((await request(url, false, 'POST')).decision, 'blocked');
  for (let i = 0; i < 16; i++) assert.equal((await request(url + '.js')).decision, 'allowed');
  await request(url + '.js');
  assert.deepEqual(failures, [{ status: 413 }]);
  const other = await fixture();
  for (let i = 0; i < 96; i++) (await other.request(url + '.js')).finish();
  await other.request(url + '.js');
  assert.deepEqual(other.failures, [{ status: 413 }]);
});

test('browser budget detects declared, chunked and accumulated bytes and subresource rate limits', async () => {
  const { session, failures } = await fixture();
  const limit = 8 * 1024 * 1024;
  const response = (status, headers) => session.emit('Network.responseReceived', { response: { status, headers } });
  response(200, { 'Content-Length': String(limit + 1) });
  response(429, { 'Retry-After': '12' });
  session.emit('Network.dataReceived', { requestId: 'a', dataLength: limit + 1 });
  session.emit('Network.loadingFinished', { requestId: 'a' });
  for (const requestId of ['b', 'c']) session.emit('Network.dataReceived', { requestId, dataLength: limit });
  assert.deepEqual(failures, [{ status: 413 }, { status: 429, retryAfter: '12' }, { status: 413 }, { status: 413 }]);
});
