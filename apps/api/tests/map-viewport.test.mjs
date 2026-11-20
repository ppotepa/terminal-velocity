import assert from 'node:assert/strict';
import test from 'node:test';
import { startServer, message, post } from './helpers.mjs';

const path = '/api/v1/internal/map/aircraft';
test('private map HTTP pages are bounded, filterable and omit message content', async t => {
  const { base } = await startServer(t);
  await post(base, message());
  const first = await fetch(`${base}${path}?bbox=18,49,22,55&limit=1`);
  assert.equal(first.status, 200);
  const page = await first.json();
  assert.equal(page.data.length, 1);
  assert.equal(page.data[0].position.source, 'DEMO_FIXTURE');
  assert.equal(page.data[0].messages.freshness, 'RECENT');
  assert.equal(JSON.stringify(page).includes('Synthetic demo status'), false);
  assert.ok(page.nextCursor);
  const second = await (await fetch(`${base}${path}?bbox=18,49,22,55&limit=1&cursor=${page.nextCursor}`)).json();
  assert.equal(second.data.length, 1);
  assert.notEqual(second.data[0].aircraftId, page.data[0].aircraftId);
  const filtered = await (await fetch(`${base}${path}?bbox=18,49,22,55&protocol=VDL2&messageStatus=RECENT`)).json();
  assert.deepEqual(filtered.data.map(x => x.aircraftId), ['ac_demo-001']);
});

test('map HTTP rejects malformed, overlarge and repeated query parameters', async t => {
  const { base } = await startServer(t);
  for (const search of ['', '?bbox=1,2,3', '?bbox=abc,1,2,3', '?bbox=1,2,3,1',
    '?bbox=0,0,180,10', '?bbox=0,0,1,1&limit=501',
    '?bbox=0,0,1,1&protocol=UNSUPPORTED', '?bbox=0,0,1,1&unexpected=1',
    '?bbox=0,0,1,1&bbox=0,0,2,2', '?bbox=0,0,1,1&cursor=garbage']) {
    const response = await fetch(`${base}${path}${search}`);
    assert.equal(response.status, 400, search);
    assert.equal((await response.json()).error.code, 'INVALID_MAP_QUERY');
  }
  const method = await fetch(`${base}${path}?bbox=0,0,1,1`, { method: 'POST' });
  assert.equal(method.status, 405);
});

test('private observed-track HTTP route is bounded and empty in memory mode', async t => {
  const { base } = await startServer(t);
  const path = '/api/v1/internal/aircraft/ac_demo-001/observed-track';
  const response = await fetch(`${base}${path}?from=1763424000000&to=1763510400000&zoom=5`);
  assert.equal(response.status, 200);
  const result = (await response.json()).data;
  assert.equal(result.aircraftId, 'ac_demo-001');
  assert.deepEqual(result.segments, []);
  for (const suffix of ['', '?from=0&to=9999999999999',
    '?from=0&to=1&zoom=23', '?from=0&to=1&extra=1',
    '?from=0&from=1&to=2']) {
    const bad = await fetch(`${base}${path}${suffix}`);
    assert.equal(bad.status, 400, suffix);
    assert.equal((await bad.json()).error.code, 'INVALID_TRACK_QUERY');
  }
  assert.equal((await fetch(`${base}${path}?from=1&to=2`, { method: 'POST' })).status, 405);
});
