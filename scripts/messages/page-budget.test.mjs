import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { boundPage } from './page-budget.mjs';

const url = 'https://app.airframes.io/messages/live';
const limit = 8 * 1024 * 1024;

async function fixture() {
  const session = new EventEmitter();
  const failures = [], decisions = [];
  let nextId = 0, open;
  session.send = async (method, params) => {
    if (method === 'Fetch.takeResponseBodyAsStream') return { stream: 'document' };
    if (method === 'IO.read') return { data: '<html></html>', eof: true };
    if (method === 'Fetch.fulfillRequest') decisions.push(params);
    if (method === 'Fetch.continueRequest' || method === 'Fetch.failRequest') decisions.push(method);
  };
  const dispose = await boundPage({
    routeWebSocket: async (_, callback) => { open = callback; },
    newCDPSession: async () => session,
  }, {}, url, failure => failures.push(failure));
  function request(href, resourceType = 'Script', method = 'GET', networkId = String(++nextId)) {
    session.emit('Fetch.requestPaused', { request: { url: href, method }, resourceType, networkId, requestId: String(nextId) });
    return { decision: decisions.at(-1), finish: () => session.emit('Network.loadingFinished', { requestId: networkId }) };
  }
  return { failures, decisions, session, request, open, dispose };
}

test('browser budget restricts navigation, methods and origins before spending network capacity', async () => {
  const { request } = await fixture();
  const first = request(url, 'Document');
  assert.equal(first.decision, 'Fetch.continueRequest');
  first.finish();
  assert.equal(request(url, 'Document').decision, 'Fetch.failRequest');
  for (const href of ['https://elsewhere.invalid/script', 'https://airframes.io.other.invalid/bootstrap',
    'https://analytics.airframes.io/script', 'http://api.airframes.io/script'])
    assert.equal(request(href).decision, 'Fetch.failRequest');
  assert.equal(request(url, 'Fetch', 'POST').decision, 'Fetch.failRequest');
  assert.equal(request('https://api.airframes.io/bootstrap', 'Fetch').decision, 'Fetch.continueRequest');
});

test('concurrent requests and successive redirect hops spend bounded budgets', async () => {
  const { request, failures } = await fixture();
  for (let i = 0; i < 16; i++) assert.equal(request(url + '.js').decision, 'Fetch.continueRequest');
  assert.equal(request(url + '.js').decision, 'Fetch.failRequest');
  assert.deepEqual(failures, [{ status: 413 }]);
  const other = await fixture();
  for (let i = 0; i < 96; i++)
    assert.equal(other.request(url + '.js', 'Script', 'GET', 'redirect-chain').decision, 'Fetch.continueRequest');
  assert.equal(other.request(url + '.js').decision, 'Fetch.failRequest');
  assert.deepEqual(other.failures, [{ status: 413 }]);
});

test('declared, chunked and accumulated bytes and bootstrap rate limits terminate a window', async () => {
  const { session, failures } = await fixture();
  const response = (status, headers) => session.emit('Network.responseReceived', { type: 'Fetch', response: { status, headers } });
  response(200, { 'Content-Length': String(limit + 1) });
  response(429, { 'Retry-After': '12' });
  session.emit('Network.dataReceived', { requestId: 'a', dataLength: limit + 1 });
  session.emit('Network.loadingFinished', { requestId: 'a' });
  for (const requestId of ['b', 'c']) session.emit('Network.dataReceived', { requestId, dataLength: limit });
  assert.deepEqual(failures, [{ status: 413 }, { status: 429, retryAfter: '12' }, { status: 413 }, { status: 413 }]);
});

function peer() {
  return { sent: [], closed: false, onMessage(fn) { this.receive = fn; }, onClose(fn) { this.disconnect = fn; },
    send(message) { this.sent.push(message); }, close() { this.closed = true; } };
}

test('only one first-party socket may connect; frames in both directions share the HTTP byte budget', async () => {
  const { open, session, failures, dispose } = await fixture();
  const client = peer(), server = peer();
  open({ ...peer(), url: () => 'wss://analytics.airframes.io/track', connectToServer: assert.fail });
  open(Object.assign(client, { url: () => 'wss://stream.airframes.io/live', connectToServer: () => server }));
  client.receive('ready');
  assert.deepEqual(server.sent, ['ready']);
  const large = Buffer.alloc(limit);
  session.emit('Network.dataReceived', { requestId: 'a', dataLength: limit });
  server.receive(large);
  client.receive(large);
  assert.deepEqual(client.sent, [large]);
  assert.deepEqual(server.sent, ['ready']);
  open({ ...peer(), url: client.url, connectToServer: assert.fail });
  assert.deepEqual(failures, [{ status: 413 }, { status: 413 }]);
  server.disconnect();
  assert.deepEqual(failures.at(-1), { status: 503 });
  await dispose();
  assert.ok(server.closed && client.closed);
});

test('a denied bootstrap is classified at response interception before its body is exposed', async () => {
  const { session, failures } = await fixture();
  for (const status of [401, 403, 429, 503]) {
    const responseHeaders = status === 429 ? [{ name: 'Retry-After', value: '8' }] : [];
    session.emit('Fetch.requestPaused', { resourceType: 'XHR', requestId: 'bootstrap',
      responseStatusCode: status, responseHeaders });
  }
  assert.deepEqual(failures, [401, 403, 429, 503].map(status => ({ status, retryAfter: status === 429 ? '8' : undefined })));
});

test('a burst of empty socket messages exhausts its count budget even below the byte limit', async () => {
  const { open, failures, dispose } = await fixture();
  const client = peer(), server = peer();
  open(Object.assign(client, { url: () => 'wss://app.airframes.io/live', connectToServer: () => server }));
  for (let i = 0; i < 257; i++) server.receive('');
  assert.equal(client.sent.length, 256);
  assert.deepEqual(failures, [{ status: 413 }]);
  await dispose();
});

test('an oversized socket update ends the attempt before forwarding its payload', async () => {
  const { open, failures, dispose } = await fixture();
  const client = peer(), server = peer();
  open(Object.assign(client, { url: () => 'wss://stream.airframes.io/live', connectToServer: () => server }));
  server.receive(Buffer.alloc(limit + 1));
  assert.deepEqual(failures, [{ status: 413 }]);
  assert.equal(client.sent.length, 0);
  await dispose();
});

test('a successful HTTP/2 document response can omit the reason phrase', async () => {
  const { session, decisions } = await fixture();
  session.emit('Fetch.requestPaused', { requestId: 'document', resourceType: 'Document',
    request: { url }, responseStatusCode: 200, responseStatusText: '', responseHeaders: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(decisions.at(-1).responsePhrase, 'OK');
  assert.equal(decisions.at(-1).responseCode, 200);
});
