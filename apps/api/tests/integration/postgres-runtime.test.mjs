import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createTestPools, resetTestData, uniqueId } from '../../../../packages/backend/tests/integration/helpers/database.mjs';
import { postgresIdentityCommitter } from '../../../../packages/backend/src/modules/fleet-identity/infrastructure/postgres/postgres-identity-committer.ts';
import { postgresPositionHistoryWriter } from '../../../../packages/backend/src/modules/flight-tracking/infrastructure/postgres/append-position.ts';
import { postgresPositionLinker } from '../../../../packages/backend/src/modules/fleet-identity/infrastructure/postgres/postgres-position-linker.ts';
import { createCurrentPositionWorker } from '../../../../packages/backend/src/modules/flight-tracking/infrastructure/postgres/current-position-projection.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
let pools;
before(() => { pools = createTestPools(); });
beforeEach(() => resetTestData(pools.admin));
after(() => pools.close());

async function launch(t) {
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['apps/api/src/main.ts'], { cwd: root,
    env: { ...process.env, PORT: String(port), STORAGE_DRIVER: 'postgres', DATABASE_URL: process.env.TEST_RUNTIME_DATABASE_URL },
    stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let diagnostics = '';
  child.stderr.on('data', data => { diagnostics += data.toString(); });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; } });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('PostgreSQL API did not become ready.')), 10_000);
    let output = '';
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error(`API exited before readiness: ${diagnostics}`)); });
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.includes('Terminal Velocity API:')) { clearTimeout(timeout); resolve(); } });
  });
  return {
    base: `http://127.0.0.1:${port}`,
    async stop(signal = 'SIGTERM') {
      child.kill(signal);
      const timeout = setTimeout(() => child.kill('SIGKILL'), 7_000);
      const [code, actualSignal] = await exited;
      clearTimeout(timeout);
      if (signal === 'SIGTERM') { assert.equal(code, 0, diagnostics); assert.equal(actualSignal, null, diagnostics); }
      else assert.equal(actualSignal, signal);
    },
  };
}
async function request(base, path, message) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(7_000),
    ...(message ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message) } : {}) });
  return { status: response.status, body: await response.json() };
}

test('actual PostgreSQL API keeps messages, idempotency and availability after a killed process restarts', { timeout: 35_000 }, async t => {
  const first = await launch(t);
  assert.deepEqual(await request(first.base, '/healthz'), { status: 200, body: { data: { status: 'ok', mode: 'demo', storage: 'postgres' } } });
  const message = { messageId: uniqueId('msg'), observedAt: new Date(Date.now() - 1_000).toISOString(),
    bearer: 'VDL2', text: 'Synthetic restart verification', icao24: 'D00001' };
  const created = await request(first.base, '/api/v1/demo/messages', message);
  assert.equal(created.status, 201);
  const deadline = Date.now() + 10_000;
  let aircraft;
  do {
    aircraft = await request(first.base, '/api/v1/aircraft/ac_demo-001');
    if (aircraft.body.data?.availability.lastMessageAt === message.observedAt) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  assert.equal(aircraft.body.data.availability.lastMessageAt, message.observedAt);
  assert.equal(aircraft.body.data.availability.freshness, 'RECENT');
  await first.stop('SIGKILL');

  const second = await launch(t);
  const restored = await request(second.base, `/api/v1/messages/${message.messageId}`);
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.body.data, created.body.data.message);
  const replay = await request(second.base, '/api/v1/demo/messages', message);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.created, false);
  const conflict = await request(second.base, '/api/v1/demo/messages', { ...message, text: 'Different immutable facts' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'MESSAGE_CONFLICT');
  const status = await request(second.base, '/api/v1/aircraft/ac_demo-001');
  assert.equal(status.body.data.availability.lastMessageAt, message.observedAt);
  await second.stop();
  const counts = await pools.admin.query(`SELECT
    (SELECT count(*)::int FROM message_ingestion.messages) AS messages,
    (SELECT count(*)::int FROM correlation.aircraft_link_revisions) AS decisions,
    (SELECT count(*)::int FROM correlation.outbox) AS events,
    (SELECT count(*)::int FROM event_delivery.consumer_inbox) AS receipts`);
  assert.deepEqual(counts.rows[0], { messages: 1, decisions: 1, events: 1, receipts: 1 });
});


test('unauthenticated demo endpoints reveal neither private provider records nor their status', { timeout: 20000 }, async t => {
  const { createSyntheticProviderPipeline } = await import('../../../../packages/backend/src/modules/source-connectors/composition/create-synthetic-provider-pipeline.ts');
  const { createFixtureCandidateDirectory } = await import('../../../../packages/backend/src/demo/infrastructure/fixture-candidate-directory.ts');
  const { createFixtureFleet } = await import('../../../../packages/backend/src/demo/infrastructure/fixture-fleet.ts');
  const { accept, NOW } = await import('../../../../packages/backend/tests/integration/helpers/provider-fixture.mjs');
  const pipeline = createSyntheticProviderPipeline(pools.runtime, createFixtureCandidateDirectory(createFixtureFleet()), () => NOW);
  assert.ok((await accept(pipeline)).ok);
  await pipeline.drain();
  const privateId = (await pools.admin.query('SELECT message_id FROM source_ingestion.message_revisions')).rows[0].message_id;
  await pools.admin.query(`INSERT INTO tracking.map_aircraft_positions
    (aircraft_id,latitude,longitude,observed_at_ms,source_id,measurement_kind,
     timestamp_precision,timestamp_uncertainty_ms)
    VALUES ('ac_demo-001',52,21,$1,'src_synthetic','ADS_B','SECOND',0)`, [Date.now() - 1000]);
  await pools.admin.query(`INSERT INTO tracking.map_aircraft_positions
    (aircraft_id,latitude,longitude,observed_at_ms,source_id,measurement_kind,
     timestamp_precision,timestamp_uncertainty_ms)
    VALUES ('ac_demo-002',52,21,$1,'src_synthetic','ADS_B','SECOND',0)`, [Date.now() - 1000]);
  const api = await launch(t);
  assert.equal((await request(api.base, '/api/v1/messages/' + privateId)).status, 404);
  const list = await request(api.base, '/api/v1/aircraft/ac_demo-001/messages');
  assert.equal(list.status, 200);
  assert.equal(JSON.stringify(list.body).includes(privateId), false);
  const aircraft = await request(api.base, '/api/v1/aircraft/ac_demo-001');
  assert.equal(aircraft.body.data.availability.freshness, 'NONE');
  assert.equal(aircraft.body.data.availability.lastMessageAt, null);
  const map = await request(api.base, '/api/v1/internal/map/aircraft?bbox=20,51,22,53');
  assert.equal(map.status, 200);
  assert.equal(map.body.data[0].messages.freshness, 'NONE');
  assert.equal(map.body.data[0].messages.lastMessageAt, null);
  assert.equal(JSON.stringify(map.body).includes(privateId), false);
  const firstPage = await request(api.base, '/api/v1/internal/map/aircraft?bbox=20,51,22,53&limit=1');
  assert.ok(firstPage.body.nextCursor);
  await pools.runtime.query(`INSERT INTO availability.contributions
    (message_id,revision,aircraft_id,observed_at_ms,bearer)
    VALUES ('msg_map-checkpoint',1,'ac_demo-002',$1,'VDL2')`, [Date.now() - 1000]);
  const stale = await request(api.base, `/api/v1/internal/map/aircraft?bbox=20,51,22,53&limit=1&cursor=${firstPage.body.nextCursor}`);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'STALE_MAP_CURSOR');
  const demo = { messageId: uniqueId('msg'), observedAt: new Date(Date.now() - 1000).toISOString(),
    bearer: 'VDL2', text: 'Synthetic public fixture', icao24: 'D00001' };
  assert.equal((await request(api.base, '/api/v1/demo/messages', demo)).status, 201);
  assert.equal((await request(api.base, '/api/v1/demo/messages', demo)).status, 200);
  await api.stop();
});

test('private HTTP track reads only actual linked PostgreSQL observations with a gap', { timeout: 20000 }, async t => {
  const commit = postgresIdentityCommitter(pools.runtime);
  await commit.createAircraft('ac_http-track');
  await commit.append({ aircraftId: 'ac_http-track', identifier: { kind: 'ICAO24', value: 'A1B2C3' },
    validFrom: 0, validUntil: null, sourceId: 'synthetic', issuer: 'test' });
  const now = Date.parse('2026-11-20T12:00:00.000Z');
  const writer = postgresPositionHistoryWriter(pools.runtime);
  const linker = postgresPositionLinker(pools.runtime);
  for (const [id, offset, latitude] of [['one', -800_000, 51], ['two', -100_000, 52]]) {
    const sourceObservationId = `epoch:synthetic-1:http-${id}`;
    const fact = { schemaVersion: 1, sourceId: 'src_synthetic', sourceObservationId,
      observedAt: new Date(now + offset).toISOString(), observedAtBasis: 'SOURCE_TIMESTAMP',
      ingestedAt: new Date(now).toISOString(), timestampPrecision: 'SECOND',
      timestampUncertaintyMs: 0, measurementKind: 'ADS_B', latitude, longitude: 20,
      quality: { nic: 8, nacP: 9 }, identifierHints: { icao24: 'A1B2C3' } };
    assert.equal((await writer.append(fact)).ok, true);
    await linker.reevaluate('src_synthetic', sourceObservationId);
  }
  const project = createCurrentPositionWorker(pools.runtime);
  for (let n = 0; n < 10; n++) if (await project() === null) break;
  const api = await launch(t);
  const track = await request(api.base,
    `/api/v1/internal/aircraft/ac_http-track/observed-track?from=${now - 900_000}&to=${now}&zoom=5`);
  assert.equal(track.status, 200);
  assert.equal(track.body.data.observedCount, 2);
  assert.deepEqual(track.body.data.segments.map(segment => segment.breakBefore), [null, 'TIME_GAP']);
  assert.deepEqual(track.body.data.segments.flatMap(segment => segment.points.map(point => point.latitude)), [51,52]);
  assert.equal(JSON.stringify(track.body).includes('destination'), false);
  await api.stop();
});
