import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { createTestPools, resetTestData } from './helpers/database.mjs';
import { postgresPositionHistoryWriter } from '../../src/modules/flight-tracking/infrastructure/postgres/append-position.ts';
import { createCurrentPositionWorker, createCurrentPositionRebuilder } from '../../src/modules/flight-tracking/infrastructure/postgres/current-position-projection.ts';
import { postgresObservedTrackReader, StaleObservedTrackCursor } from '../../src/modules/flight-tracking/infrastructure/postgres/observed-track-reader.ts';
import { postgresIdentityCommitter } from '../../src/modules/fleet-identity/infrastructure/postgres/postgres-identity-committer.ts';
import { postgresPositionLinker } from '../../src/modules/fleet-identity/infrastructure/postgres/postgres-position-linker.ts';

const pools = createTestPools();
beforeEach(() => resetTestData(pools.admin));
after(() => pools.close());
const noon = Date.parse('2026-11-20T12:00:00.000Z');
const key = id => `epoch:synthetic-1:${id}`;
const query = (overrides = {}) => ({ aircraftId: 'ac_track',
  fromObservedAtMs: noon - 500_000, toObservedAtMs: noon,
  limit: 2, pointBudget: 2, zoom: 10, ...overrides });
async function setup() {
  const commit = postgresIdentityCommitter(pools.runtime);
  await commit.createAircraft('ac_track');
  await commit.append({ aircraftId: 'ac_track', identifier: { kind: 'ICAO24', value: 'A0B1C2' },
    validFrom: 0, validUntil: null, sourceId: 'synthetic', issuer: 'test' });
}
async function append(id, observedAtMs, latitude, longitude) {
  const observation = { schemaVersion: 1, sourceId: 'src_synthetic',
    sourceObservationId: key(id), observedAt: new Date(observedAtMs).toISOString(),
    observedAtBasis: 'SOURCE_TIMESTAMP', ingestedAt: new Date(noon).toISOString(),
    timestampPrecision: 'SECOND', timestampUncertaintyMs: 0,
    measurementKind: 'ADS_B', latitude, longitude, quality: { nic: 8, nacP: 9 },
    identifierHints: { icao24: 'A0B1C2' } };
  assert.equal((await postgresPositionHistoryWriter(pools.runtime).append(observation)).ok, true);
  await postgresPositionLinker(pools.runtime).reevaluate('src_synthetic', key(id));
}
async function project() {
  const work = createCurrentPositionWorker(pools.runtime);
  for (let n = 0; n < 20; n++) if (await work() === null) return;
  throw new Error('Track fixture projection did not drain.');
}

test('paged observed track preserves facts, wrap/gap reasons and page continuation', async () => {
  await setup();
  await append('three', noon - 180_000, 89, -179.4);
  await append('one', noon - 200_000, 89, 179.5);
  await append('four', noon - 100_000, 30, 30);
  await append('two', noon - 190_000, 89, -179.5);
  await project();
  const reader = postgresObservedTrackReader(pools.runtime);
  const first = await reader.read(query());
  assert.equal(first.observedCount, 2);
  assert.equal(first.hasMore, true);
  assert.deepEqual(first.segments.map(segment => segment.breakBefore), [null, 'ANTIMERIDIAN_WRAP']);
  assert.deepEqual(first.segments.flatMap(segment => segment.points.map(point => point.sourceObservationId)),
    [key('one'), key('two')]);
  assert.equal(first.segments[0].points[0].quality.nacP, 9);
  assert.deepEqual(await reader.read(query()), first);
  const second = await reader.read(query({ after: first.next }));
  assert.equal(second.hasMore, false);
  assert.equal(second.segments[0].continuesPrevious, true);
  assert.equal(second.segments[1].breakBefore, 'IMPLAUSIBLE_JUMP');
  assert.deepEqual(second.segments.flatMap(segment => segment.points.map(point => point.sourceObservationId)),
    [key('three'), key('four')]);
  assert.equal(JSON.stringify([first, second]).includes('destination'), false);
});

test('a projection change rejects an old page cursor rather than silently mixing versions', async () => {
  await setup();
  await append('one', noon - 200_000, 10, 10);
  await append('two', noon - 190_000, 10.01, 10.01);
  await append('three', noon - 180_000, 10.02, 10.02);
  await project();
  const reader = postgresObservedTrackReader(pools.runtime);
  const first = await reader.read(query());
  assert.ok(first.next);
  await append('late', noon - 170_000, 10.03, 10.03);
  await project();
  await assert.rejects(() => reader.read(query({ after: first.next })),
    error => error instanceof StaleObservedTrackCursor && error.code === 'STALE_OBSERVED_TRACK_CURSOR');
  assert.equal((await reader.read(query())).observedCount, 2);
});

test('bounded rebuild changes the checkpoint and empty aircraft return no guessed geometry', async () => {
  await setup();
  const reader = postgresObservedTrackReader(pools.runtime);
  assert.deepEqual((await reader.read(query())).segments, []);
  await append('one', noon - 200_000, 10, 10);
  await append('two', noon - 190_000, 10.01, 10.01);
  await project();
  const before = await reader.read(query({ limit: 1, pointBudget: 1 }));
  await createCurrentPositionRebuilder(pools.runtime)('ac_track', noon - 500_000, noon);
  const after = await reader.read(query({ limit: 1, pointBudget: 1 }));
  assert.ok(after.projectionRevision > before.projectionRevision);
  assert.deepEqual(after.segments.flatMap(segment => segment.points.map(point => point.sourceObservationId)),
    [key('one')]);
  await assert.rejects(() => reader.read(query({ limit: 1, pointBudget: 1,
    after: { ...before.next, aircraftId: 'ac_other' } })),
    /Invalid observed track query/);
});
