import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  positionSourceId,
} from '../src/modules/flight-tracking/public/index.ts';
import {
  adsbLolPointUrl,
  adsbLolPositionQuery,
} from '../src/modules/source-connectors/infrastructure/positions/adsb-lol/query.ts';
import {
  parseAdsbLolPositionSnapshot,
} from '../src/modules/source-connectors/infrastructure/positions/adsb-lol/parse-snapshot.ts';
import {
  createPositionRequestBudget,
} from '../src/modules/source-connectors/infrastructure/positions/adsb-lol/request-budget.ts';
import {
  createAdsbLolPositionTransport,
  createAdsbLolPositionTransportForTest,
} from '../src/modules/source-connectors/infrastructure/positions/adsb-lol/transport.ts';
import {
  createAdsbLolPositionPoller,
} from '../src/modules/source-connectors/infrastructure/positions/adsb-lol/poller.ts';

const SOURCE_ID = positionSourceId('src_adsblol-test').value;
const FETCHED_AT = '2026-11-19T12:00:02.000Z';
const QUERY = adsbLolPositionQuery({ latitude: 52.52, longitude: 13.405, radiusNm: 10 }).value;
const FIXTURE = JSON.parse(await readFile(new URL('./fixtures/positions/adsb-lol-v2-synthetic.json', import.meta.url),
  'utf8'));

function snapshot(input = FIXTURE) {
  return parseAdsbLolPositionSnapshot(input, { sourceId: SOURCE_ID, fetchedAt: FETCHED_AT, query: QUERY });
}

function budget(options = {}) {
  return createPositionRequestBudget({ minimumIntervalMs: 1, rollingWindowMs: 60_000,
    maxRequestsPerWindow: 100, ...options });
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...init,
  });
}

function transport(fetcher, options = {}) {
  return createAdsbLolPositionTransportForTest(QUERY, SOURCE_ID, {
    fetch: fetcher,
    now: () => Date.parse(FETCHED_AT),
    requestBudget: budget(),
    ...options,
  });
}

test('synthetic provider fixture maps ADS-B, MLAT, source age, optional fields and incomplete coverage', () => {
  const parsed = snapshot();
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.provider, 'adsb.lol');
  assert.equal(parsed.value.aircraftReturned, 5);
  assert.equal(parsed.value.unresolvedIdentityCount, 1);
  assert.equal(parsed.value.noPositionCount, 1);
  assert.equal(parsed.value.observations.length, 3);
  assert.deepEqual(parsed.value.coverage.kind, 'SAMPLED');
  assert.equal(parsed.value.coverage.completeness, 'UNKNOWN');
  assert.match(parsed.value.coverage.description, /completeness is unknown/u);
  assert.deepEqual(parsed.value.requestBudget, {
    minimumIntervalMs: 600_000,
    maximumRequestsPerRollingWindow: 200,
    rollingWindowMs: 86_400_000,
    maximumRadiusNm: 50,
  });

  const [adsb, mlat, other] = parsed.value.observations;
  assert.equal(adsb.measurementKind, 'ADS_B');
  assert.equal(adsb.latitude, 52.52);
  assert.equal(adsb.longitude, 13.405);
  assert.equal(adsb.observedAt, '2026-11-19T11:59:58.750Z');
  assert.equal(adsb.observedAtBasis, 'SOURCE_AGE_FROM_REFERENCE');
  assert.equal(adsb.sourceTimeReferenceAt, '2026-11-19T12:00:00.000Z');
  assert.equal(adsb.sourceAgeSeconds, 1.25);
  assert.equal(adsb.identifierHints.icao24, 'A0B1C2');
  assert.equal(adsb.identifierHints.callsign, 'TV123');
  assert.equal(adsb.groundSpeedKnots, 0);
  assert.equal(adsb.trackDegrees, 0);
  assert.equal(adsb.trackKind, 'TRUE_HEADING');
  assert.deepEqual(adsb.altitudes, [{ kind: 'SURFACE', valueFt: null }]);
  assert.deepEqual(adsb.quality, { nic: 8, nacP: 9, containmentRadiusMeters: 75 });
  assert.equal(mlat.measurementKind, 'MLAT');
  assert.equal(mlat.identifierHints.icao24, 'A0B1C4');
  assert.equal(mlat.observedAt, '2026-11-19T11:00:00.000Z');
  assert.equal(mlat.ingestedAt, FETCHED_AT);
  assert.equal(mlat.groundSpeedKnots, null);
  assert.equal(mlat.altitudes, null);
  assert.equal('trackDegrees' in mlat, false);
  assert.equal('trackKind' in mlat, false);
  assert.equal(other.measurementKind, 'OTHER');
  assert.equal(other.measurementDetail, 'adsb.lol:future_source_type');
  assert.equal(other.latitude, 52.523);
  assert.equal(other.longitude, 13.408);
  assert.equal('altitudes' in other, false);
  assert.equal('trackDegrees' in other, false);
});

test('ground barometric state intentionally takes precedence over simultaneous geometric altitude', () => {
  const withGeometry = structuredClone(FIXTURE);
  withGeometry.ac[0].alt_geom = 300;
  assert.deepEqual(snapshot(withGeometry).value.observations[0].altitudes,
    [{ kind: 'SURFACE', valueFt: null }]);
});

test('query constructor enforces the local geographic cap and creates only the provider point URL', () => {
  assert.equal(adsbLolPositionQuery({ latitude: -90, longitude: 180, radiusNm: 50 }).ok, true);
  for (const input of [
    { latitude: 90.1, longitude: 0, radiusNm: 1 },
    { latitude: 0, longitude: -181, radiusNm: 1 },
    { latitude: 0, longitude: 0, radiusNm: 51 },
    { latitude: 0, longitude: 0, radiusNm: 0 },
    { latitude: 0, longitude: 0, radiusNm: 1, apiKey: 'not-accepted' },
  ]) assert.equal(adsbLolPositionQuery(input).ok, false);
  assert.equal(adsbLolPointUrl(QUERY), 'https://api.adsb.lol/v2/lat/52.52/lon/13.405/dist/10');
});

test('transport validates a JavaScript caller query before it can make a request', () => {
  for (const input of [
    { latitude: 52.52, longitude: 13.405, radiusNm: 51 },
    { latitude: 92, longitude: 13.405, radiusNm: 10 },
    { latitude: 52.52, longitude: Number.NaN, radiusNm: 10 },
  ]) assert.throws(() => createAdsbLolPositionTransport(input, SOURCE_ID), RangeError);
  assert.throws(() => createAdsbLolPositionTransport(QUERY, SOURCE_ID, {
    requestBudget: budget(),
  }), /cannot be overridden/u);
});

test('snapshot parser rejects malformed envelope, source errors, coordinate pairs and time evidence', () => {
  assert.equal(snapshot({ ...FIXTURE, total: 6 }).error.field, 'total');
  assert.equal(snapshot({ ...FIXTURE, msg: 'provider unavailable' }).error.code, 'SOURCE_REPORTED_FAILURE');
  assert.equal(snapshot({ ...FIXTURE, now: '1795089600000' }).error.field, 'now');
  assert.equal(snapshot({ ...FIXTURE, ptime: -1 }).error.field, 'ptime');
  const halfPosition = structuredClone(FIXTURE);
  halfPosition.ac[0].lon = null;
  assert.equal(snapshot(halfPosition).error.code, 'INVALID_AIRCRAFT');
  const invalidAge = structuredClone(FIXTURE);
  invalidAge.ac[0].seen_pos = Number.NaN;
  assert.equal(snapshot(invalidAge).error.code, 'INVALID_AIRCRAFT');
  const invalidCoordinate = structuredClone(FIXTURE);
  invalidCoordinate.ac[0].lat = 90.1;
  assert.equal(snapshot(invalidCoordinate).error.code, 'INVALID_AIRCRAFT');
  const swappedCoordinates = structuredClone(FIXTURE);
  [swappedCoordinates.ac[0].lat, swappedCoordinates.ac[0].lon] =
    [swappedCoordinates.ac[0].lon, swappedCoordinates.ac[0].lat];
  assert.equal(snapshot(swappedCoordinates).error.error.field, 'query-area');
  const invalidTrack = structuredClone(FIXTURE);
  invalidTrack.ac[0].track = 360;
  assert.equal(snapshot(invalidTrack).error.code, 'INVALID_AIRCRAFT');
  const invalidHex = structuredClone(FIXTURE);
  invalidHex.ac[0].hex = 'not-icao';
  assert.equal(snapshot(invalidHex).error.error.field, 'hex');
  const unresolvedOnly = structuredClone(FIXTURE);
  unresolvedOnly.ac = [structuredClone(FIXTURE.ac[4])];
  unresolvedOnly.total = 1;
  assert.equal(snapshot(unresolvedOnly).value.observations.length, 0);
  assert.equal(snapshot(unresolvedOnly).value.unresolvedIdentityCount, 1);
  const duplicate = structuredClone(FIXTURE);
  duplicate.ac[1].hex = duplicate.ac[0].hex;
  assert.equal(snapshot(duplicate).error.code, 'DUPLICATE_OBSERVATION_ID');
});

test('request budget enforces minimum spacing and a rolling request ceiling', () => {
  const limited = createPositionRequestBudget({ minimumIntervalMs: 10, rollingWindowMs: 100, maxRequestsPerWindow: 2 });
  assert.equal(limited.tryAcquire(1000).ok, true);
  assert.deepEqual(limited.tryAcquire(1005).error, { code: 'MINIMUM_INTERVAL', retryAfterMs: 5 });
  assert.equal(limited.tryAcquire(1010).ok, true);
  assert.deepEqual(limited.tryAcquire(1020).error, { code: 'REQUEST_BUDGET_EXHAUSTED', retryAfterMs: 80 });
  assert.deepEqual(limited.tryAcquire(900).error, { code: 'REQUEST_BUDGET_EXHAUSTED', retryAfterMs: 80 });
  assert.equal(limited.tryAcquire(1110).ok, true);
});

test('transport reads one bounded JSON snapshot and charges every attempted request', async () => {
  const calls = [];
  const adapter = transport(async (url, init) => {
    calls.push({ url, method: init.method, accept: init.headers.accept, redirect: init.redirect });
    return jsonResponse(FIXTURE);
  });
  const first = await adapter.fetchNext();
  assert.equal(first.ok, true);
  assert.deepEqual(calls, [{ url: adsbLolPointUrl(QUERY), method: 'GET', accept: 'application/json', redirect: 'error' }]);

  const limited = createPositionRequestBudget({ minimumIntervalMs: 1, rollingWindowMs: 60_000, maxRequestsPerWindow: 1 });
  const requestTimes = [Date.parse(FETCHED_AT), Date.parse(FETCHED_AT), Date.parse(FETCHED_AT),
    Date.parse(FETCHED_AT) + 2];
  const onlyOne = transport(async () => jsonResponse(FIXTURE), {
    requestBudget: limited,
    now: () => requestTimes.shift() ?? Date.parse(FETCHED_AT) + 2,
  });
  assert.equal((await onlyOne.fetchNext()).ok, true);
  assert.deepEqual((await onlyOne.fetchNext()).error,
    { code: 'REQUEST_BUDGET_EXHAUSTED', retryAfterMs: 59_998 });
});

test('transport shares its default in-process budget across independently created transports', async () => {
  const left = createAdsbLolPositionTransport(QUERY, SOURCE_ID, {
    fetch: async () => jsonResponse(FIXTURE), now: () => Date.now(),
  });
  const right = createAdsbLolPositionTransport(QUERY, SOURCE_ID, {
    fetch: async () => jsonResponse(FIXTURE), now: () => Date.now(),
  });
  assert.equal((await left.fetchNext()).ok, true);
  assert.equal((await right.fetchNext()).error.code, 'MINIMUM_INTERVAL');
});

test('transport categorizes 429, Retry-After, temporary, authentication and invalid responses', async () => {
  const rateLimited = transport(async () => new Response('', { status: 429, headers: { 'retry-after': '17' } }));
  assert.deepEqual((await rateLimited.fetchNext()).error, { code: 'RATE_LIMITED', retryAfterMs: 17_000 });
  const temporary = transport(async () => new Response('', { status: 503, headers: { 'retry-after': '30' } }));
  assert.deepEqual((await temporary.fetchNext()).error,
    { code: 'TEMPORARY_FAILURE', status: 503, retryAfterMs: 30_000 });
  const unauthenticated = transport(async () => new Response('', { status: 403 }));
  assert.deepEqual((await unauthenticated.fetchNext()).error, { code: 'AUTHENTICATION_FAILURE', status: 403 });
  const wrongMime = transport(async () => new Response('<html/>', { headers: { 'content-type': 'text/html' } }));
  assert.deepEqual((await wrongMime.fetchNext()).error, { code: 'INVALID_RESPONSE', field: 'content-type' });
  const invalidJson = transport(async () => new Response('{', { headers: { 'content-type': 'application/json' } }));
  assert.deepEqual((await invalidJson.fetchNext()).error, { code: 'INVALID_RESPONSE', field: 'body' });
  const tooLarge = transport(async () => new Response('123456', {
    headers: { 'content-type': 'application/json', 'content-length': '6' },
  }), { maximumResponseBytes: 5 });
  assert.deepEqual((await tooLarge.fetchNext()).error, { code: 'INVALID_RESPONSE', field: 'body' });
});

test('transport distinguishes timeout and caller cancellation', async () => {
  const timedOut = transport((_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }), { timeoutMs: 5 });
  assert.deepEqual((await timedOut.fetchNext()).error, { code: 'TIMEOUT', retryAfterMs: 60_000 });

  const cancelled = transport((_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  const controller = new AbortController();
  const pending = cancelled.fetchNext(controller.signal);
  controller.abort();
  assert.deepEqual((await pending).error, { code: 'ABORTED' });

  const timedOutBody = transport(async () => new Response(new ReadableStream({
    pull: () => new Promise(() => undefined),
  }), { headers: { 'content-type': 'application/json' } }), { timeoutMs: 5 });
  assert.deepEqual((await timedOutBody.fetchNext()).error, { code: 'TIMEOUT', retryAfterMs: 60_000 });
});

test('poller honors Retry-After, applies capped backoff and emits snapshots and errors', async () => {
  const retry = (retryAfterMs, code = 'TEMPORARY_FAILURE') => ({ ok: false, error: { code, retryAfterMs } });
  const results = [
    retry(15 * 60_000, 'RATE_LIMITED'),
    retry(0),
    { ok: true, value: snapshot().value },
    { ok: false, error: { code: 'AUTHENTICATION_FAILURE', status: 403 } },
  ];
  let calls = 0;
  const waits = [];
  const events = [];
  const poller = createAdsbLolPositionPoller({ fetchNext: async () => results[calls++] }, {
    maximumBackoffMs: 25 * 60_000,
    wait: async milliseconds => { waits.push(milliseconds); },
  });
  assert.equal(poller.health().status, 'NOT_STARTED');
  await poller.start(event => { events.push(event); });
  assert.deepEqual(poller.health(), {
    status: 'STOPPED',
    lastSuccessAt: '2026-11-19T12:00:02.000Z',
    consecutiveFailures: 1,
    lastErrorCode: 'AUTHENTICATION_FAILURE',
  });
  assert.deepEqual(waits, [15 * 60_000, 20 * 60_000, 10 * 60_000]);
  assert.deepEqual(events.map(event => event.type), ['error', 'error', 'snapshot', 'error']);
  assert.equal(calls, 4);
  await poller.stop();
  assert.throws(() => poller.start(() => undefined), /only once/u);
});

test('poller reconnects after a disconnected transport and reports recovered health', async () => {
  let calls = 0;
  const events = [];
  const poller = createAdsbLolPositionPoller({ fetchNext: async () => {
    calls += 1;
    if (calls === 1) return { ok: false, error: { code: 'TEMPORARY_FAILURE', retryAfterMs: 0 } };
    return { ok: true, value: snapshot().value };
  } }, { wait: async () => undefined });
  await poller.start(event => {
    events.push(event.type);
    if (event.type === 'snapshot') void poller.stop();
  });
  assert.deepEqual(events, ['error', 'snapshot']);
  assert.equal(calls, 2);
  assert.equal(poller.health().consecutiveFailures, 0);
  assert.equal(poller.health().lastErrorCode, null);
});

test('poller stop cancels an in-flight request and a pending wait without leaving a timer', async () => {
  let calls = 0;
  const pendingTransport = {
    fetchNext: signal => new Promise(resolve => {
      calls += 1;
      signal.addEventListener('abort', () => resolve({ ok: false, error: { code: 'ABORTED' } }), { once: true });
    }),
  };
  const requestPoller = createAdsbLolPositionPoller(pendingTransport);
  const requestLoop = requestPoller.start(() => undefined);
  await Promise.resolve();
  await requestPoller.stop();
  await requestLoop;
  assert.equal(calls, 1);

  let waitingSignal;
  const waitingPoller = createAdsbLolPositionPoller({ fetchNext: async () => ({ ok: true, value: snapshot().value }) }, {
    wait: (_milliseconds, signal) => new Promise(resolve => {
      waitingSignal = signal;
      signal.addEventListener('abort', resolve, { once: true });
    }),
  });
  const waitLoop = waitingPoller.start(() => undefined);
  for (let turn = 0; turn < 10 && !waitingSignal; turn += 1) await Promise.resolve();
  assert.equal(waitingSignal.aborted, false);
  await waitingPoller.stop();
  await waitLoop;
  assert.equal(waitingSignal.aborted, true);
});

test('poller refuses an interval shorter than the documented conservative provider limit', () => {
  assert.throws(() => createAdsbLolPositionPoller({ fetchNext: async () => ({ ok: true, value: snapshot().value }) }, {
    minimumPollIntervalMs: 1000,
  }), /at least the provider minimum/u);
});
