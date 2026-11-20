import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiClient, ApiClientError } from '../src/shared/api/api-client.ts';
import { decodeMapSnapshot } from '../src/shared/api/map-snapshot.ts';

const good = {
  data: [{ aircraftId: 'ac_demo-001', secret: 'hidden',
    position: { latitude: 52, longitude: 21, observedAt: '2026-11-20T12:00:00.000Z',
      freshness: 'CURRENT', source: 'DEMO_FIXTURE', measurementKind: 'DEMO' },
    messages: { freshness: 'NONE', lastMessageAt: null, coverage: 'UNKNOWN', feedHealth: 'DISCONNECTED' } }],
  nextCursor: null, asOf: '2026-11-20T12:00:01.000Z', checkpoint: 0,
};

test('typed map adapter validates the wire shape and discards unknown fields', () => {
  const decoded = decodeMapSnapshot(good);
  assert.equal(decoded.data[0].aircraftId, 'ac_demo-001');
  assert.equal(JSON.stringify(decoded).includes('secret'), false);
  for (const bad of [{ ...good, data: new Array(501).fill(good.data[0]) },
    { ...good, data: [{ ...good.data[0], position: { ...good.data[0].position, latitude: 200 } }] },
    { ...good, data: [{ ...good.data[0], messages: { ...good.data[0].messages, feedHealth: 'HEALTHY' } }] }]) {
    assert.throws(() => decodeMapSnapshot(bad), /Invalid map/);
  }
});

test('API client sends a scoped query and surfaces safe HTTP errors', async () => {
  let requested;
  const client = createApiClient(async (url, options) => {
    requested = { url: url.href, signal: options.signal };
    return Response.json(good);
  }, 'http://127.0.0.1:5173');
  const signal = new AbortController().signal;
  const body = await client.request('/api/v1/internal/map/aircraft', { bbox: '14,48,24,56' }, signal);
  assert.equal(body.data.length, 1);
  assert.equal(requested.url, 'http://127.0.0.1:5173/api/v1/internal/map/aircraft?bbox=14%2C48%2C24%2C56');
  assert.equal(requested.signal, signal);
  const failing = createApiClient(async () => Response.json({ error: { code: 'STALE_MAP_CURSOR',
    message: 'Request a new page.' } }, { status: 409 }), 'http://127.0.0.1:5173');
  await assert.rejects(failing.request('/api/v1/internal/map/aircraft', {}, signal),
    error => error instanceof ApiClientError && error.code === 'STALE_MAP_CURSOR' && error.status === 409);
});
