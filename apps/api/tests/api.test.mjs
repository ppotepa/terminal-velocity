import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { AIRCRAFT_ID, message, post, startServer, stubTracker } from './helpers.mjs';

test('health explicitly identifies demo mode and in-memory storage', async t => {
  const { base } = await startServer(t);
  const response = await fetch(`${base}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { status: 'ok', mode: 'demo', storage: 'memory' } });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('fixture aircraft list and a selected aircraft are exposed through data envelopes', async t => {
  const { base } = await startServer(t);
  const list = await fetch(`${base}/api/v1/aircraft`);
  const body = await list.json();
  assert.equal(list.status, 200);
  assert.equal(body.data.length, 3);
  assert.ok(body.data.some(item => item.aircraftId === AIRCRAFT_ID));
  const response = await fetch(`${base}/api/v1/aircraft/${AIRCRAFT_ID}`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.availability.freshness, 'NONE');
});

test('valid message creates once, updates freshness, and can be retrieved via both reads', async t => {
  const { base } = await startServer(t);
  const response = await post(base, message());
  assert.equal(response.status, 201);
  const receipt = (await response.json()).data;
  assert.equal(receipt.created, true);
  assert.equal(receipt.message.correlation.aircraftId, AIRCRAFT_ID);
  assert.equal(receipt.message.correlation.outcome, 'MATCHED');

  const duplicate = await post(base, message());
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).data.created, false);
  const messages = await fetch(`${base}/api/v1/aircraft/${AIRCRAFT_ID}/messages`);
  assert.equal((await messages.json()).data.length, 1);
  const individual = await fetch(`${base}/api/v1/messages/msg_demo-001`);
  assert.equal(individual.status, 200);
  assert.equal((await individual.json()).data.messageId, 'msg_demo-001');
  const aircraft = await fetch(`${base}/api/v1/aircraft/${AIRCRAFT_ID}`);
  assert.equal((await aircraft.json()).data.availability.freshness, 'RECENT');
});

test('backfill uses observation time, not HTTP arrival time, for freshness', async t => {
  const { base } = await startServer(t);
  const response = await post(base, message({ observedAt: '2026-11-18T10:00:00.000Z' }));
  assert.equal(response.status, 201);
  await response.json();
  const aircraft = (await (await fetch(`${base}/api/v1/aircraft/${AIRCRAFT_ID}`)).json()).data;
  assert.equal(aircraft.availability.freshness, 'NONE');
  assert.equal(aircraft.availability.lastMessageAt, '2026-11-18T10:00:00.000Z');
});

test('same message id with different content is a conflict', async t => {
  const { base } = await startServer(t);
  await (await post(base, message())).json();
  const response = await post(base, message({ text: 'Different synthetic content' }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'MESSAGE_CONFLICT');
});

test('backend validation receives unknown JSON and rejects malformed domain input', async t => {
  const { base } = await startServer(t);
  for (const value of [null, [], {}, message({ publicEligible: true })]) {
    const response = await post(base, value);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
  }
});

test('invalid JSON returns 400 before invoking ingest', async t => {
  let calls = 0;
  const { base } = await startServer(t, stubTracker({ ingest: async () => { calls++; throw new Error('must not run'); } }));
  const response = await fetch(`${base}/api/v1/demo/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"messageId":',
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_JSON');
  assert.equal(calls, 0);
});

test('invalid UTF-8 is not silently replaced inside an otherwise valid JSON string', async t => {
  const { base } = await startServer(t);
  const response = await fetch(`${base}/api/v1/demo/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: new Uint8Array([34, 0xff, 34]),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_JSON');
});

test('a declared request over 16 KiB returns 413 without ingesting it', async t => {
  const { base } = await startServer(t);
  const response = await fetch(`${base}/api/v1/demo/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(16 * 1024) }),
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'PAYLOAD_TOO_LARGE');
});

test('the 16 KiB limit also applies to chunked bodies without Content-Length', async t => {
  const { base } = await startServer(t);
  const received = await new Promise((resolve, reject) => {
    const request = httpRequest(`${base}/api/v1/demo/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.write('{"text":"');
    request.write('x'.repeat(10_000));
    request.write('x'.repeat(10_000));
    request.end('"}');
  });
  assert.equal(received.status, 413);
  assert.equal(received.body.error.code, 'PAYLOAD_TOO_LARGE');
});

test('missing or unsupported media type/charset returns 415', async t => {
  const { base } = await startServer(t);
  for (const contentType of ['text/plain', 'application/xml', 'application/json; charset=iso-8859-1', '']) {
    const response = await fetch(`${base}/api/v1/demo/messages`, {
      method: 'POST', headers: contentType ? { 'Content-Type': contentType } : {}, body: Buffer.from('{}'),
    });
    assert.equal(response.status, 415);
    assert.equal((await response.json()).error.code, 'UNSUPPORTED_MEDIA_TYPE');
  }
});

test('nonexistent endpoints and resources return 404 envelopes', async t => {
  const { base } = await startServer(t);
  for (const path of ['/missing', '/api/v1/aircraft/ac_unknown', '/api/v1/aircraft/ac_unknown/messages', '/api/v1/messages/msg_unknown']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
  }
});

test('known routes reject unsupported methods with 405 and an explicit Allow header', async t => {
  const { base } = await startServer(t);
  for (const [path, method, allow] of [['/api/v1/aircraft', 'POST', 'GET'], ['/api/v1/demo/messages', 'GET', 'POST'], ['/healthz', 'OPTIONS', 'GET']]) {
    const response = await fetch(`${base}${path}`, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), allow);
    assert.equal((await response.json()).error.code, 'METHOD_NOT_ALLOWED');
  }
});

test('unsupported query parameters and malformed encoded path segments return 400', async t => {
  const { base } = await startServer(t);
  for (const path of ['/api/v1/aircraft?bbox=1,2,3,4', '/healthz?verbose=true', '/api/v1/aircraft/%ZZ', '/api/v1/aircraft/%2F']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 400);
    assert.ok(['UNSUPPORTED_QUERY', 'INVALID_URL'].includes((await response.json()).error.code));
  }
});

test('thrown internal failures do not expose exception details', async t => {
  const { base } = await startServer(t, stubTracker({ listAircraft: async () => { throw new Error('secret-provider-token'); } }));
  const response = await fetch(`${base}/api/v1/aircraft`);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred.' } });
});

test('typed backend errors have explicit statuses and INTERNAL_ERROR is sanitized', async t => {
  for (const [code, expected] of [['VALIDATION_ERROR', 400], ['NOT_FOUND', 404], ['MESSAGE_CONFLICT', 409],
    ['CAPACITY_EXCEEDED', 429], ['CANDIDATE_SET_INCOMPLETE', 503], ['INTERNAL_ERROR', 500]]) {
    await t.test(code, async nested => {
      const { base } = await startServer(nested, stubTracker({ listAircraft: async () => ({ ok: false, error: { code, message: 'test-detail' } }) }));
      const response = await fetch(`${base}/api/v1/aircraft`);
      assert.equal(response.status, expected);
      const body = await response.json();
      assert.equal(body.error.code, code);
      assert.equal(body.error.message, code === 'INTERNAL_ERROR' ? 'An internal error occurred.' : 'test-detail');
    });
  }
});
