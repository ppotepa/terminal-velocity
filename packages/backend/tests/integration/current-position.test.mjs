import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { createTestPools, resetTestData } from './helpers/database.mjs';
import { postgresPositionHistoryWriter } from '../../src/modules/flight-tracking/infrastructure/postgres/append-position.ts';
import { createCurrentPositionWorker, createCurrentPositionRebuilder } from '../../src/modules/flight-tracking/infrastructure/postgres/current-position-projection.ts';
import { postgresCurrentPositionReader } from '../../src/modules/flight-tracking/infrastructure/postgres/current-position-reader.ts';
import { backfillCurrentPositionLinks } from '../../src/modules/flight-tracking/infrastructure/postgres/backfill-current-position.ts';
import { postgresIdentityCommitter } from '../../src/modules/fleet-identity/infrastructure/postgres/postgres-identity-committer.ts';
import { postgresPositionLinker } from '../../src/modules/fleet-identity/infrastructure/postgres/postgres-position-linker.ts';
import { icao24 } from '../../src/modules/aircraft-correlation/public/index.ts';

const pools = createTestPools();
beforeEach(() => resetTestData(pools.admin));
after(() => pools.close());
const at = value => new Date(value).toISOString();
const noon = Date.parse('2026-11-20T12:00:00.000Z');
const key = suffix => `epoch:synthetic-1:${suffix}`;
const position = (suffix, time, quality, kind = 'ADS_B') => ({ schemaVersion: 1,
  sourceId: 'src_synthetic', sourceObservationId: key(suffix),
  observedAt: at(time), observedAtBasis: 'SOURCE_TIMESTAMP', ingestedAt: at(noon),
  timestampPrecision: 'MILLISECOND', timestampUncertaintyMs: 0,
  measurementKind: kind, latitude: 50, longitude: 10,
  identifierHints: { icao24: 'A0B1C2' }, ...(quality ? { quality } : {}),
});
const read = (id, now = noon) => postgresCurrentPositionReader(pools.runtime)
  .read(id, at(now), { currentWithinMs: 60_000 });
async function setupAircraft(id = 'ac_a') {
  const commit = postgresIdentityCommitter(pools.runtime);
  await commit.createAircraft(id);
  const assertion = await commit.append({ aircraftId: id,
    identifier: { kind: 'ICAO24', value: icao24('A0B1C2').value },
    validFrom: 0, validUntil: null, sourceId: 'synthetic', issuer: 'test' });
  return { commit, assertion };
}
async function add(suffix, time, quality, kind) {
  assert.equal((await postgresPositionHistoryWriter(pools.runtime).append(
    position(suffix, time, quality, kind))).ok, true);
  await postgresPositionLinker(pools.runtime).reevaluate('src_synthetic', key(suffix));
}
async function drain(worker = createCurrentPositionWorker(pools.runtime)) {
  const results = [];
  for (let n = 0; n < 20; n++) {
    const result = await worker();
    if (result === null) return results;
    results.push(result);
  }
  throw new Error('Current-position queue did not drain.');
}

test('out-of-order arrivals retain the newest observed position and independent freshness', async () => {
  await setupAircraft();
  assert.deepEqual((await read('ac_a')).observation, null);
  await add('new', noon - 10_000, { nic: 1 });
  await add('old', noon - 20_000, { nic: 11 });
  assert.deepEqual(await drain(), ['APPLIED', 'APPLIED']);
  const current = await read('ac_a');
  assert.equal(current.observation.sourceObservationId, key('new'));
  assert.equal(current.revision, 1);
  assert.equal(current.freshness, 'CURRENT');
  assert.equal((await read('ac_a', noon + 50_001)).freshness, 'STALE');
  assert.equal((await read('ac_a', noon - 30_000)).freshness, 'UNKNOWN');
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM availability.contributions')).rows[0].n, '0');
});

test('equal-time quality wins, then a newer lower-quality observation supersedes', async () => {
  await setupAircraft();
  await add('weak', noon - 30_000, { nic: 1 });
  await add('strong', noon - 30_000, { nic: 11 });
  await drain();
  assert.equal((await read('ac_a')).observation.sourceObservationId, key('strong'));
  await add('later', noon - 29_000, { nic: 0 }, 'MLAT');
  await drain();
  assert.equal((await read('ac_a')).observation.sourceObservationId, key('later'));
});

test('equal evidence from independent sources follows configured source priority', async () => {
  await setupAircraft();
  await add('source-a', noon - 10_000, { nic: 8 });
  const second = { ...position('source-b', noon - 10_000, { nic: 8 }), sourceId: 'src_other' };
  assert.equal((await postgresPositionHistoryWriter(pools.runtime).append(second)).ok, true);
  await postgresPositionLinker(pools.runtime).reevaluate('src_other', key('source-b'));
  await drain(createCurrentPositionWorker(pools.runtime, sourceId => sourceId === 'src_other' ? 10 : 0));
  const selected = await read('ac_a');
  assert.equal(selected.observation.sourceId, 'src_other');
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM tracking.position_observations')).rows[0].n, '2');
});

test('identity correction removes the old owner and selects a replacement without changing facts', async () => {
  const { commit, assertion } = await setupAircraft();
  await commit.createAircraft('ac_b');
  await add('first', noon - 30_000, { nic: 5 });
  await add('second', noon - 20_000, { nic: 3 });
  await drain();
  assert.equal((await read('ac_a')).observation.sourceObservationId, key('second'));
  await commit.append({ aircraftId: 'ac_b', identifier: { kind: 'ICAO24', value: 'A0B1C2' },
    validFrom: 0, validUntil: null, sourceId: 'synthetic', issuer: 'test' }, assertion.assertionId);
  const linker = postgresPositionLinker(pools.runtime);
  await linker.reevaluate('src_synthetic', key('first'));
  await linker.reevaluate('src_synthetic', key('second'));
  await drain();
  const old = await read('ac_a');
  const next = await read('ac_b');
  assert.equal(old.observation, null);
  assert.equal(old.freshness, 'UNKNOWN');
  assert.equal(old.revision, 3);
  assert.equal(next.observation.sourceObservationId, key('second'));
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM tracking.position_observations')).rows[0].n, '2');
});

test('inbox, effect and acknowledgment roll back together, then replay is idempotent', async () => {
  await setupAircraft();
  await add('rollback', noon - 10_000, { nic: 4 });
  const broken = createCurrentPositionWorker(pools.runtime, () => { throw new Error('injected priority failure'); });
  await assert.rejects(() => broken(), /injected priority failure/);
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM tracking.current_position_inbox')).rows[0].n, '0');
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM tracking.current_position_candidates')).rows[0].n, '0');
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM tracking.current_position_jobs
    WHERE completed_at IS NULL`)).rows[0].n, '1');
  assert.deepEqual(await drain(), ['APPLIED']);
  const before = await read('ac_a');
  await pools.admin.query('UPDATE tracking.current_position_jobs SET completed_at=NULL');
  assert.deepEqual(await drain(), ['DUPLICATE']);
  assert.deepEqual(await read('ac_a'), before);
});

test('concurrent consumers serialize revisions and a bounded rebuild repairs candidates', async () => {
  await setupAircraft();
  await add('one', noon - 10_000, { nic: 1 });
  await add('two', noon - 9_000, { nic: 1 });
  const worker = createCurrentPositionWorker(pools.runtime);
  const outcomes = await Promise.all([worker(), worker()]);
  assert.deepEqual(outcomes, ['APPLIED', 'APPLIED']);
  assert.equal((await read('ac_a')).observation.sourceObservationId, key('two'));
  await pools.admin.query('DELETE FROM tracking.current_position_candidates');
  const rebuild = createCurrentPositionRebuilder(pools.runtime);
  assert.equal(await rebuild('ac_a', noon - 60_000, noon), 2);
  assert.equal((await read('ac_a')).observation.sourceObservationId, key('two'));
  await assert.rejects(() => rebuild('ac_a', noon - 86_400_001, noon), /bounded/);
});

test('preexisting link heads backfill in durable pages without duplicating queued decisions', async () => {
  await setupAircraft();
  await add('backfill-one', noon - 15_000, { nic: 2 });
  await add('backfill-two', noon - 10_000, { nic: 3 });
  await pools.admin.query('DELETE FROM tracking.current_position_jobs');
  assert.deepEqual(await backfillCurrentPositionLinks(pools.runtime, 1), { queued: 1, complete: false });
  assert.deepEqual(await backfillCurrentPositionLinks(pools.runtime, 1), { queued: 1, complete: false });
  assert.deepEqual(await backfillCurrentPositionLinks(pools.runtime, 1), { queued: 0, complete: true });
  assert.deepEqual(await backfillCurrentPositionLinks(pools.runtime, 1), { queued: 0, complete: true });
  assert.deepEqual(await drain(), ['APPLIED', 'APPLIED']);
  assert.equal((await read('ac_a')).observation.sourceObservationId, key('backfill-two'));
});

test('a superseded link job is acknowledged without regressing the projected owner', async () => {
  const { commit, assertion } = await setupAircraft();
  await commit.createAircraft('ac_b');
  await add('fenced', noon - 10_000, { nic: 3 });
  await commit.append({ aircraftId: 'ac_b', identifier: { kind: 'ICAO24', value: 'A0B1C2' },
    validFrom: 0, validUntil: null, sourceId: 'synthetic', issuer: 'test' }, assertion.assertionId);
  await postgresPositionLinker(pools.runtime).reevaluate('src_synthetic', key('fenced'));
  assert.deepEqual(await drain(), ['SUPERSEDED', 'APPLIED']);
  assert.equal((await read('ac_a')).observation, null);
  assert.equal((await read('ac_b')).observation.sourceObservationId, key('fenced'));
});
