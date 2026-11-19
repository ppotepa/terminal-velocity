import assert from 'node:assert/strict';
import test from 'node:test';
import { createProviderConnector } from '../src/modules/source-connectors/composition/create-provider-connector.ts';
import { airframesConnection } from '../src/modules/source-connectors/infrastructure/airframes/connection.ts';
import { pageUrl } from '../src/modules/source-connectors/infrastructure/airframes/page-window.ts';

const icao = 'ABC123';
const row = { icao, messagePath: '/messages/fixture', text: 'Synthetic', station: null };
const page = (rows = [row]) => ({ status: 200, body: { source: pageUrl, icao, status: 'OBSERVED', messages: rows } });
const preview = async () => 'PREVIEWED';

function setup(read) {
  let now = 1000;
  const starts = [];
  const connection = airframesConnection(icao, async (scope, signal) => {
    assert.equal(scope, icao);
    starts.push(now);
    return read(starts.length, signal);
  }, { now: () => now, random: () => 0.75, wait: async ms => { now += ms; } });
  return { connection, starts };
}

test('disabled strategies never open a page or call acceptance', async () => {
  for (const [strategy, expected] of [['api', 'API_UNAVAILABLE'], ['crawl', 'RIGHTS_BLOCKED']]) {
    const disabled = createProviderConnector(strategy, '', strategy === 'api' ? { kind: 'SYNTHETIC_PAGE', read: assert.fail } : undefined);
    assert.equal(await disabled.start(assert.fail), expected);
    assert.equal(disabled.health().lastReceivedAt, null);
    await disabled.stop();
  }
  assert.throws(() => createProviderConnector('crawl', '*', { kind: 'SYNTHETIC_PAGE', read: assert.fail }), /ICAO24/);
});

test('429 and unavailable responses respect quota, date/seconds Retry-After and jitter before reconnect', async () => {
  for (const retryAfter of ['5', 'Thu, 01 Jan 1970 00:00:06 GMT']) {
    const { connection, starts } = setup(n => n === 1 ? { status: 429, retryAfter }
      : n === 2 ? { status: 503 } : page());
    assert.equal(await connection.start(preview), 'COMPLETE');
    assert.deepEqual(starts, [1000, 6000, 9000]);
  }
  const { connection, starts } = setup(() => ({ status: 429, retryAfter: '60' }));
  assert.equal(await connection.start(preview), 'RATE_LIMITED');
  assert.equal(await connection.start(preview), 'RATE_LIMITED');
  assert.deepEqual(starts, [1000]);
});

test('repeated disconnects stop after three attempts and permanent responses do not retry', async () => {
  const { connection, starts } = setup(() => { throw Error('unavailable'); });
  assert.equal(await connection.start(preview), 'TEMPORARY_FAILURE');
  assert.deepEqual(starts, [1000, 2500, 5500]);
  for (const status of [302, 401, 403, 404]) {
    const run = setup(() => ({ status }));
    assert.equal(await run.connection.start(preview), 'PERMANENT_FAILURE');
    assert.equal(run.starts.length, 1);
  }
});

test('malformed envelopes and size, scope or queue violations deliver nothing', async () => {
  for (const [response, expected] of [
    [{ status: 200 }, 'INVALID_ENVELOPE'], [page([row, { ...row, icao: '000000' }]), 'INVALID_ENVELOPE'],
    [page([{ ...row, text: '界'.repeat(12000) }]), 'INVALID_ENVELOPE'],
    [page(Array(26).fill(row)), 'QUEUE_FULL'], [page(Array(5).fill({ ...row, text: 'x'.repeat(32000) })), 'QUEUE_FULL'],
    [{ ...page(), body: { ...page().body, status: 'PARTIAL_LAYOUT' } }, 'INVALID_ENVELOPE'],
    [{ ...page(), body: { ...page().body, source: 'https://invalid.example/' } }, 'INVALID_ENVELOPE'],
  ]) {
    const { connection } = setup(() => response);
    assert.equal(await connection.start(assert.fail), expected);
    assert.equal(connection.health().accepted, 0);
  }
});

test('stop drains pending acceptance and suppresses the next delivery; concurrent starts share one read', async () => {
  const { connection, starts } = setup(() => page([row, { ...row, messagePath: '/messages/second' }]));
  const pending = Promise.withResolvers(), entered = Promise.withResolvers();
  let calls = 0;
  const run = connection.start(async () => { calls++; entered.resolve(); return pending.promise; });
  assert.equal(connection.start(assert.fail), run);
  await entered.promise;
  assert.equal(connection.health().state, 'HEALTHY');
  assert.equal(connection.health().coverage, 'UNKNOWN');
  let stopped = false;
  const stop = connection.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  pending.resolve({ ok: true, value: { outcome: 'CREATED' } });
  assert.equal(await run, 'STOPPED');
  await Promise.all([stop, connection.stop()]);
  assert.equal(connection.health().accepted, 1);
  assert.equal(connection.health().state, 'DISCONNECTED');
  assert.equal(calls, 1);
  assert.equal(await connection.start(preview), 'COMPLETE');
  assert.deepEqual(starts, [1000, 2000]);
});

test('cancelled reads ignore late responses and pre-aborted runs open no page', async () => {
  const pending = Promise.withResolvers();
  const { connection, starts } = setup(() => pending.promise);
  const outer = new AbortController();
  const run = connection.start(assert.fail, outer.signal);
  outer.abort();
  const stop = connection.stop();
  pending.resolve(page());
  assert.equal(await run, 'STOPPED');
  await stop;
  assert.equal(await connection.start(assert.fail, outer.signal), 'STOPPED');
  assert.equal(starts.length, 1);
});

test('uncertain commits retry the identical delivery; permanent acceptance failures stop', async () => {
  const { connection, starts } = setup(() => page());
  const received = [];
  assert.equal(await connection.start(async delivery => {
    received.push(delivery);
    if (received.length === 1) throw Error('interrupted');
    assert.equal(connection.health().state, 'DEGRADED');
    if (received.length === 2) return { ok: false, error: { code: 'UNAVAILABLE' } };
    return { ok: true, value: { outcome: 'DUPLICATE' } };
  }), 'COMPLETE');
  assert.equal(received.length, 3);
  assert.ok(received.every(item => item === received[0]));
  assert.equal(starts.length, 1);
  assert.equal(connection.health().accepted, 1);
  let attempts = 0;
  assert.equal(await connection.start(async () => {
    attempts++;
    return { ok: false, error: { code: 'CONFLICTED' } };
  }), 'ACCEPTANCE_FAILED');
  assert.equal(attempts, 1);
  assert.equal(connection.health().accepted, 0);
});

test('stop cancels retry sleep without a second request', async () => {
  const sleeping = Promise.withResolvers();
  let requests = 0;
  const connection = airframesConnection(icao, async () => { requests++; return { status: 503 }; }, {
    now: () => 0, random: () => 0,
    wait: async (_, signal) => {
      sleeping.resolve();
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
  });
  const run = connection.start(assert.fail);
  await sleeping.promise;
  await connection.stop();
  assert.equal(await run, 'STOPPED');
  assert.equal(requests, 1);
});

test('on-demand preview hands transient cards to its caller without calling durable acceptance', async () => {
  const cards = [];
  const transport = createProviderConnector('crawl', icao, { kind: 'ON_DEMAND_PREVIEW',
    read: async () => page(), inspect: envelope => cards.push(envelope.raw) });
  assert.equal(await transport.start(assert.fail), 'COMPLETE');
  assert.deepEqual(cards, [row]);
  assert.equal(transport.health().accepted, 0);
});

test('partial previews validate every retained row before invoking the transient callback', async () => {
  for (const [rows, expected] of [[[row], 'COMPLETE'], [[row, { ...row, icao: 'DEF456' }], 'INVALID_ENVELOPE']]) {
    const cards = [];
    const response = page(rows);
    response.body.status = 'PARTIAL_LAYOUT';
    const transport = createProviderConnector('crawl', icao, { kind: 'ON_DEMAND_PREVIEW',
      read: async () => response, inspect: envelope => cards.push(envelope.raw) });
    assert.equal(await transport.start(assert.fail), expected);
    assert.deepEqual(cards, expected === 'COMPLETE' ? [row] : []);
    assert.equal(transport.health().accepted, 0);
  }
});
