import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTestPools, resetTestData } from './helpers/database.mjs';
import {
  positionHistoryByIcao24Query, positionHistoryWithinBoundsQuery,
} from '../../src/modules/flight-tracking/public/index.ts';
import { postgresPositionHistoryWriter } from '../../src/modules/flight-tracking/infrastructure/postgres/append-position.ts';
import { postgresPositionHistoryReader } from '../../src/modules/flight-tracking/infrastructure/postgres/query-position-history.ts';

const execute = promisify(execFile);
const pools = createTestPools();
beforeEach(() => resetTestData(pools.admin));
after(() => pools.close());
const fact = (id, overrides = {}) => ({
  schemaVersion: 1, sourceId: 'src_synthetic-a', sourceObservationId: `epoch:synthetic-1:${id}`,
  sourceDeliveryRef: `delivery:${id}`,
  observedAt: '2026-11-19T11:00:00Z', observedAtBasis: 'SOURCE_TIMESTAMP',
  ingestedAt: '2026-11-19T11:00:01Z', timestampPrecision: 'SECOND',
  timestampUncertaintyMs: 1000, measurementKind: 'ADS_B',
  latitude: 51.5, longitude: 179.9, identifierHints: { icao24: 'A0B1C2' }, ...overrides,
});
const query = (overrides = {}) => positionHistoryByIcao24Query({
  icao24Hint: 'a0b1c2', fromObservedAtMs: Date.parse('2026-11-19T10:00:00Z'),
  toObservedAtMs: Date.parse('2026-11-19T12:00:00Z'), limit: 2, ...overrides,
}).value;

test('confirmed identity requires an upstream decision on first write and survives restart replay and history', async () => {
  const writer = postgresPositionHistoryWriter(pools.runtime);
  const confirmed = fact('confirmed', {
    confirmedAircraftId: 'ac_synthetic-1',
    identityEvidence: { resolverId: 'resolver_synthetic', evidenceRef: 'decision:confirmed' },
  });
  const decision = {
    status: 'CONFIRMED', sourceId: confirmed.sourceId,
    sourceObservationId: confirmed.sourceObservationId,
    aircraftId: confirmed.confirmedAircraftId, icao24: 'A0B1C2',
    resolverId: 'resolver_synthetic', evidenceRef: 'decision:confirmed',
  };
  assert.deepEqual((await writer.append(confirmed)).error,
    { code: 'INVALID_POSITION_OBSERVATION', error: { code: 'UNSUPPORTED_CONFIRMED_IDENTITY' } });
  assert.deepEqual((await writer.append(confirmed, { ...decision, aircraftId: 'ac_other' })).error,
    { code: 'INVALID_POSITION_OBSERVATION', error: { code: 'UNSUPPORTED_CONFIRMED_IDENTITY' } });
  assert.deepEqual((await writer.append(confirmed, { ...decision, icao24: 'FFFFFF' })).error,
    { code: 'INVALID_POSITION_OBSERVATION', error: { code: 'CONFLICTING_POSITION_IDENTIFIERS' } });
  assert.equal((await pools.runtime.query('SELECT * FROM tracking.position_observations')).rowCount, 0);
  const inserted = await writer.append(confirmed, decision);
  assert.equal(inserted.value.status, 'INSERTED');
  const laterReceipt = { ...confirmed, ingestedAt: '2026-11-19T11:05:00Z', sourceDeliveryRef: 'delivery:confirmed-retry' };
  const restarted = await execute(process.execPath,
    [new URL('./helpers/position-worker.mjs', import.meta.url).pathname],
    { env: { ...process.env, TV_SYNTHETIC_POSITION: JSON.stringify(laterReceipt),
      TV_SYNTHETIC_IDENTITY_DECISION: JSON.stringify(decision) } });
  const replay = JSON.parse(restarted.stdout);
  assert.equal(replay.value.status, 'ALREADY_PRESENT');
  assert.equal(replay.value.eventId, inserted.value.eventId);
  assert.equal(replay.value.observation.ingestedAt, '2026-11-19T11:00:01.000Z');
  assert.equal(replay.value.observation.sourceDeliveryRef, 'delivery:confirmed');
  assert.deepEqual(replay.value.observation.identityEvidence, confirmed.identityEvidence);
  const history = await postgresPositionHistoryReader(pools.runtime).byIcao24(query());
  assert.equal(history.observations.length, 1);
  assert.equal(history.observations[0].confirmedAircraftId, confirmed.confirmedAircraftId);
  assert.deepEqual(history.observations[0].identityEvidence, confirmed.identityEvidence);
  assert.equal((await pools.runtime.query('SELECT * FROM tracking.position_observations')).rowCount, 1);
  assert.equal((await pools.runtime.query('SELECT * FROM tracking.position_observation_outbox')).rowCount, 1);
});

test('concurrent first writes and restart retries create one immutable fact and event', async () => {
  const writer = postgresPositionHistoryWriter(pools.runtime);
  const results = await Promise.all(Array.from({ length: 6 }, () => writer.append(fact('race',
    { quality: { nic: 8, containmentRadiusMeters: null } }))));
  assert.equal(results.filter(result => result.ok && result.value.status === 'INSERTED').length, 1);
  assert.equal(results.filter(result => result.ok && result.value.status === 'ALREADY_PRESENT').length, 5);
  assert.equal(new Set(results.map(result => result.value.eventId)).size, 1);
  const restarted = await execute(process.execPath,
    [new URL('./helpers/position-worker.mjs', import.meta.url).pathname],
    { env: { ...process.env, TV_SYNTHETIC_POSITION: JSON.stringify(fact('race',
      { quality: { nic: 8, containmentRadiusMeters: null } })) } });
  assert.equal(JSON.parse(restarted.stdout).value.status, 'ALREADY_PRESENT');
  const laterReceipt = await writer.append(fact('race', {
    ingestedAt: '2026-11-19T11:05:00Z', sourceDeliveryRef: 'delivery:retry',
    quality: { nic: 8, containmentRadiusMeters: null },
  }));
  assert.equal(laterReceipt.value.status, 'ALREADY_PRESENT');
  assert.equal(laterReceipt.value.observation.ingestedAt, '2026-11-19T11:00:01.000Z');
  assert.equal(laterReceipt.value.observation.sourceDeliveryRef, 'delivery:race');
  assert.equal((await pools.runtime.query('SELECT * FROM tracking.position_observations')).rowCount, 1);
  assert.equal((await pools.runtime.query('SELECT * FROM tracking.position_observation_outbox')).rowCount, 1);
  assert.deepEqual((await writer.append(fact('race', { latitude: 51.6 }))).error,
    { code: 'SOURCE_OBSERVATION_CONFLICT' });
  const stored = (await pools.runtime.query('SELECT latitude, quality FROM tracking.position_observations')).rows[0];
  assert.equal(stored.latitude, 51.5);
  assert.deepEqual(stored.quality, { nic: 8, containmentRadiusMeters: null });
});

test('independent sources, reordered time, bounded keyset history and antimeridian bounds', async () => {
  const writer = postgresPositionHistoryWriter(pools.runtime);
  for (const item of [
    fact('later', { observedAt: '2026-11-19T11:00:02Z' }),
    fact('earlier', { observedAt: '2026-11-19T10:59:59Z' }),
    fact('same-coords-other-source', { sourceId: 'src_synthetic-b', longitude: -179.9 }),
    fact('same-coords-new-measurement'),
    fact('same-source-new-epoch', { sourceObservationId: 'epoch:synthetic-2:later' }),
  ]) assert.equal((await writer.append(item)).ok, true);
  const reader = postgresPositionHistoryReader(pools.runtime);
  const first = await reader.byIcao24(query());
  assert.deepEqual(first.observations.map(item => item.sourceObservationId),
    ['epoch:synthetic-1:earlier', 'epoch:synthetic-1:same-coords-new-measurement']);
  assert.ok(first.next);
  const second = await reader.byIcao24(query({ after: first.next }));
  assert.deepEqual(second.observations.map(item => item.sourceObservationId),
    ['epoch:synthetic-2:later', 'epoch:synthetic-1:same-coords-other-source']);
  const third = await reader.byIcao24(query({ after: second.next }));
  assert.deepEqual(third.observations.map(item => item.sourceObservationId), ['epoch:synthetic-1:later']);
  assert.equal(third.next, null);
  const bounds = positionHistoryWithinBoundsQuery({
    bounds: { west: 179, east: -179, south: 50, north: 52 },
    fromObservedAtMs: query().fromObservedAtMs, toObservedAtMs: query().toObservedAtMs, limit: 10,
  }).value;
  assert.equal((await reader.withinBounds(bounds)).observations.length, 5);
  assert.equal((await reader.withinBounds(positionHistoryWithinBoundsQuery({
    fromObservedAtMs: query().fromObservedAtMs, toObservedAtMs: query().toObservedAtMs,
    limit: 10, bounds: { west: -10, east: 10, south: 50, north: 52 },
  }).value)).observations.length, 0);
});

test('invalid data and outbox failure leave no partial position history', async () => {
  const writer = postgresPositionHistoryWriter(pools.runtime, () => 'invalid-event-id');
  assert.deepEqual((await writer.append(fact('preview', { sourceObservationId: 'preview:snapshot:aircraft' }))).error,
    { code: 'UNSTABLE_SOURCE_OBSERVATION_ID' });
  assert.equal((await writer.append(fact('invalid', { longitude: 180.01 }))).ok, false);
  await assert.rejects(() => writer.append(fact('outbox-failure')), error => error.code === '23514');
  assert.equal((await pools.runtime.query('SELECT * FROM tracking.position_observations')).rowCount, 0);
  assert.equal((await pools.runtime.query('SELECT * FROM tracking.position_observation_outbox')).rowCount, 0);
  await assert.rejects(() => pools.runtime.query(`INSERT INTO tracking.position_observations
    (observation_id,source_id,source_observation_id,observed_at_ms,ingested_at_ms,measurement_kind,latitude,longitude,fact)
    VALUES ('00000000-0000-4000-8000-000000000001','src_synthetic-a','bad',0,0,'ADS_B',91,0,'{}')`),
  error => error.code === '23514');
});

test('tracking runtime cannot mutate facts and required indexes and owner exist', async () => {
  const writer = postgresPositionHistoryWriter(pools.runtime);
  assert.equal((await writer.append(fact('immutable'))).ok, true);
  for (const statement of [
    'UPDATE tracking.position_observations SET latitude=0',
    'DELETE FROM tracking.position_observations',
    'UPDATE tracking.position_observation_outbox SET payload=payload',
    'DELETE FROM tracking.position_observation_outbox',
  ]) await assert.rejects(() => pools.runtime.query(statement), error => error.code === '42501');
  const owner = await pools.admin.query(`SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='tracking'`);
  assert.equal(owner.rows[0].owner, 'tv_tracking_owner');
  const role = await pools.admin.query(`SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls
    FROM pg_roles WHERE rolname='tv_tracking_owner'`);
  assert.equal(role.rowCount, 1);
  assert.ok(Object.values(role.rows[0]).every(value => value === false));
  const grants = await pools.admin.query(`SELECT has_table_privilege('tv_runtime','tracking.position_observations','SELECT') AS read,
    has_table_privilege('tv_runtime','tracking.position_observations','INSERT') AS append,
    has_table_privilege('tv_runtime','tracking.position_observations','UPDATE') AS update,
    has_table_privilege('tv_runtime','tracking.position_observations','DELETE') AS delete`);
  assert.deepEqual(grants.rows[0], { read: true, append: true, update: false, delete: false });
  const indexes = await pools.admin.query(`SELECT indexname FROM pg_indexes WHERE schemaname='tracking'`);
  const names = new Set(indexes.rows.map(row => row.indexname));
  assert.ok(names.has('position_observations_icao24_time'));
  assert.ok(names.has('position_observations_position_gist'));
  const client = await pools.admin.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_seqscan=off');
    const plan = await client.query(`EXPLAIN SELECT source_observation_id
      FROM tracking.position_observations WHERE position <@ box(point(179,50),point(180,52))`);
    assert.match(plan.rows.map(row => row['QUERY PLAN']).join(' '), /position_observations_position_gist/);
  } finally { await client.query('ROLLBACK'); client.release(); }
});
