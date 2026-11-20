import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { createTestPools, resetTestData } from './helpers/database.mjs';
import { mapViewportQuery } from '../../src/modules/map-projection/domain/map-query.ts';
import { createPostgresMapReader } from '../../src/modules/map-projection/infrastructure/postgres-map-reader.ts';
import { postgresPositionHistoryWriter } from '../../src/modules/flight-tracking/infrastructure/postgres/append-position.ts';
import { createCurrentPositionWorker } from '../../src/modules/flight-tracking/infrastructure/postgres/current-position-projection.ts';
import { postgresIdentityCommitter } from '../../src/modules/fleet-identity/infrastructure/postgres/postgres-identity-committer.ts';
import { postgresPositionLinker } from '../../src/modules/fleet-identity/infrastructure/postgres/postgres-position-linker.ts';

const pools = createTestPools();
beforeEach(() => resetTestData(pools.admin));
after(() => pools.close());
const now = Date.parse('2026-11-20T12:00:00.000Z');
const reader = createPostgresMapReader(pools.runtime, () => now);
const query = (bbox, overrides = {}) => mapViewportQuery({
  bbox: { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] }, limit: 500, ...overrides });

async function marker(id, lat, lon, observedAtMs = now - 120_000) {
  await pools.admin.query(`INSERT INTO tracking.map_aircraft_positions
    (aircraft_id,latitude,longitude,observed_at_ms,source_id,measurement_kind,
     timestamp_precision,timestamp_uncertainty_ms)
    VALUES ($1,$2,$3,$4,'src_synthetic','ADS_B','SECOND',0)`, [id,lat,lon,observedAtMs]);
}

test('bbox includes edges, splits the antimeridian and returns an empty viewport', async () => {
  await marker('ac_east', 10, 179.5);
  await marker('ac_west', 10, -179.5);
  await marker('ac_middle', 10, 0);
  assert.deepEqual((await reader.read(query([179,9,-179,11]))).data.map(x => x.aircraftId),
    ['ac_east','ac_west']);
  assert.deepEqual((await reader.read(query([-1,9,1,11]))).data.map(x => x.aircraftId),
    ['ac_middle']);
  assert.deepEqual((await reader.read(query([30,9,31,11]))).data, []);
  assert.equal((await reader.read(query([0,10,1,10]))).data.length, 1);
});

test('position and synthetic message status use independent observation times and protocol filters', async () => {
  await marker('ac_demo-001', 50, 20, now - 120_000);
  await pools.runtime.query(`INSERT INTO availability.contributions
    (message_id,revision,aircraft_id,observed_at_ms,bearer)
    VALUES ('msg_demo-1',1,'ac_demo-001',$1,'VDL2')`, [now - 1_000]);
  const [item] = (await reader.read(query([19,49,21,51]))).data;
  assert.equal(item.position.freshness, 'STALE');
  assert.equal(item.messages.freshness, 'RECENT');
  assert.equal(item.messages.lastMessageAt, new Date(now - 1_000).toISOString());
  assert.equal(item.messages.coverage, 'UNKNOWN');
  assert.equal(item.messages.feedHealth, 'DISCONNECTED');
  assert.equal(JSON.stringify(item).includes('msg_demo-1'), false);
  assert.equal((await reader.read(query([19,49,21,51], { protocol: 'VDL2' }))).data.length, 1);
  assert.equal((await reader.read(query([19,49,21,51], { protocol: 'HFDL' }))).data.length, 0);
  assert.equal((await reader.read(query([19,49,21,51], { positionStatus: 'CURRENT' }))).data.length, 0);
  assert.equal((await reader.read(query([19,49,21,51], { messageStatus: 'RECENT' }))).data.length, 1);
  await pools.runtime.query(`UPDATE availability.contributions SET revision=2,
    aircraft_id=NULL,observed_at_ms=NULL,bearer=NULL WHERE message_id='msg_demo-1'`);
  assert.equal((await reader.read(query([19,49,21,51]))).data[0].messages.freshness, 'NONE');
});

test('bounded keyset pages reject a changed checkpoint and never exceed the limit', async () => {
  await pools.admin.query(`INSERT INTO tracking.map_aircraft_positions
    (aircraft_id,latitude,longitude,observed_at_ms,source_id,measurement_kind,
     timestamp_precision,timestamp_uncertainty_ms)
    SELECT 'ac_bulk-' || lpad(n::text,4,'0'),10,n::float8/10000,$1,
      'src_synthetic','ADS_B','SECOND',0 FROM generate_series(1,601) n`, [now - 1_000]);
  const first = await reader.read(query([0,9,1,11], { limit: 500 }));
  assert.equal(first.data.length, 500);
  assert.ok(first.nextCursor);
  const second = await reader.read(query([0,9,1,11], { limit: 500, cursor: first.nextCursor }));
  assert.equal(second.data.length, 101);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.data,...second.data].map(x => x.aircraftId)).size, 601);
  await pools.runtime.query(`INSERT INTO availability.contributions
    (message_id,revision,aircraft_id,observed_at_ms,bearer)
    VALUES ('msg_checkpoint',1,'ac_bulk-0001',$1,'VDL2')`, [now - 1_000]);
  await assert.rejects(() => reader.read(query([0,9,1,11], { limit: 500, cursor: first.nextCursor })),
    /STALE_MAP_CURSOR/);
});

test('a confirmed current-position head updates the denormalized map row in its transaction', async () => {
  const commit = postgresIdentityCommitter(pools.runtime);
  await commit.createAircraft('ac_linked');
  await commit.append({ aircraftId: 'ac_linked', identifier: { kind: 'ICAO24', value: 'A0B1C2' },
    validFrom: 0, validUntil: null, sourceId: 'synthetic', issuer: 'test' });
  const observation = { schemaVersion: 1, sourceId: 'src_synthetic',
    sourceObservationId: 'epoch:synthetic-1:map', observedAt: new Date(now - 10_000).toISOString(),
    observedAtBasis: 'SOURCE_TIMESTAMP', ingestedAt: new Date(now).toISOString(),
    timestampPrecision: 'SECOND', timestampUncertaintyMs: 0,
    measurementKind: 'ADS_B', latitude: 52, longitude: 21,
    identifierHints: { icao24: 'A0B1C2' } };
  assert.equal((await postgresPositionHistoryWriter(pools.runtime).append(observation)).ok, true);
  await postgresPositionLinker(pools.runtime).reevaluate('src_synthetic', observation.sourceObservationId);
  assert.equal(await createCurrentPositionWorker(pools.runtime)(), 'APPLIED');
  const page = await reader.read(query([20,51,22,53]));
  assert.equal(page.data[0].aircraftId, 'ac_linked');
  assert.equal(page.data[0].position.freshness, 'CURRENT');
  assert.equal(page.data[0].messages.freshness, 'NONE');
  assert.ok(page.checkpoint > 0);
  const indexes = await pools.admin.query(`SELECT indexname FROM pg_indexes
    WHERE schemaname='tracking' AND tablename='map_aircraft_positions'`);
  assert.ok(indexes.rows.some(row => row.indexname === 'map_aircraft_positions_gist'));
});
