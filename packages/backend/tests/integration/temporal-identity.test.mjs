import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { createTestPools, resetTestData } from './helpers/database.mjs';
import { icao24, registration } from '../../src/modules/aircraft-correlation/public/index.ts';
import { createResolveAircraft, createRegistryCandidateDirectory } from '../../src/modules/fleet-identity/public/index.ts';
import { postgresIdentityReader } from '../../src/modules/fleet-identity/infrastructure/postgres/postgres-identity-reader.ts';
import { postgresIdentityCommitter } from '../../src/modules/fleet-identity/infrastructure/postgres/postgres-identity-committer.ts';
import { postgresPositionLinker } from '../../src/modules/fleet-identity/infrastructure/postgres/postgres-position-linker.ts';
import { postgresReplayRequestReader } from '../../src/modules/fleet-identity/infrastructure/postgres/postgres-replay-request-reader.ts';
import { postgresPositionHistoryWriter } from '../../src/modules/flight-tracking/infrastructure/postgres/append-position.ts';
import { createSyntheticProviderPipeline } from '../../src/modules/source-connectors/composition/create-synthetic-provider-pipeline.ts';
import { createIdentityReplayWorker } from '../../src/modules/source-connectors/composition/create-identity-replay-worker.ts';
import { fixture, accept, NOW } from './helpers/provider-fixture.mjs';

const pools = createTestPools();
beforeEach(() => resetTestData(pools.admin));
after(() => pools.close());
const hex = value => ({ kind: 'ICAO24', value: icao24(value).value });
const tail = value => ({ kind: 'REGISTRATION', value: registration(value).value });
const claim = (aircraftId, identifier, from, until = null) => ({
  aircraftId, identifier, validFrom: from, validUntil: until,
  sourceId: 'synthetic', issuer: 'test',
});
const position = (id, observedAt) => ({ schemaVersion: 1,
  sourceId: 'src_synthetic', sourceObservationId: `epoch:synthetic-1:${id}`,
  observedAt: new Date(observedAt).toISOString(), observedAtBasis: 'SOURCE_TIMESTAMP',
  ingestedAt: '2026-11-20T12:00:00.000Z', timestampPrecision: 'SECOND',
  timestampUncertaintyMs: null, measurementKind: 'ADS_B', latitude: 50,
  longitude: 10, identifierHints: { icao24: 'A0B1C2' },
});

test('temporal registry transfers aliases and retains historical position facts and link revisions', async () => {
  const commit = postgresIdentityCommitter(pools.runtime);
  const reader = postgresIdentityReader(pools.runtime);
  const resolve = createResolveAircraft(reader);
  await commit.createAircraft('ac_a'); await commit.createAircraft('ac_b');
  const boundary = Date.parse('2026-11-19T12:00:00Z');
  const prior = await commit.append(claim('ac_a', hex('a0b1c2'), 0, boundary));
  await commit.append(claim('ac_b', hex('A0B1C2'), boundary));
  assert.equal((await resolve([hex('A0B1C2')], boundary - 1)).aircraftId, 'ac_a');
  assert.equal((await resolve([hex('A0B1C2')], boundary)).aircraftId, 'ac_b');
  const writer = postgresPositionHistoryWriter(pools.runtime);
  assert.equal((await writer.append(position('old', boundary - 1000))).ok, true);
  const linker = postgresPositionLinker(pools.runtime);
  const first = await linker.reevaluate('src_synthetic', 'epoch:synthetic-1:old');
  assert.equal(first.aircraftId, 'ac_a');
  const correction = await commit.append(claim('ac_b', hex('A0B1C2'), 0), prior.assertionId);
  assert.equal(correction.revision, 3);
  assert.equal((await resolve([hex('A0B1C2')], boundary - 1)).aircraftId, 'ac_b');
  const replay = await linker.replayAlias('a0b1c2', 0, boundary, 10);
  assert.equal(replay.decisions[0].aircraftId, 'ac_b');
  assert.equal(replay.decisions[0].revision, 2);
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM tracking.position_observations`)).rows[0].n, '1');
  assert.deepEqual((await pools.runtime.query(`SELECT aircraft_id FROM fleet_identity.position_link_revisions
    ORDER BY revision`)).rows.map(row => row.aircraft_id), ['ac_a', 'ac_b']);
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM fleet_identity.replay_requests`)).rows[0].n, '5');
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM fleet_identity.assertions`)).rows[0].n, '3');
  const history = await reader.history('ac_a');
  assert.equal(history.length, 1);
  assert.equal(history[0].assertionId, prior.assertionId);
  assert.ok(history[0].supersededAt);
  const requests = await postgresReplayRequestReader(pools.runtime).list(0, 10);
  assert.equal(requests.length, 5);
  assert.deepEqual(requests.slice(-3).map(request => request.validUntil), [boundary, null, null]);
});

test('overlapping owners and competing identifiers remain ambiguous or conflicted', async () => {
  const commit = postgresIdentityCommitter(pools.runtime);
  for (const id of ['ac_a', 'ac_b']) await commit.createAircraft(id);
  await commit.append(claim('ac_a', hex('A0B1C2'), 0));
  await commit.append(claim('ac_b', hex('A0B1C2'), 0));
  await commit.append(claim('ac_b', tail('n123ab'), 0));
  const resolve = createResolveAircraft(postgresIdentityReader(pools.runtime));
  assert.equal((await resolve([hex('A0B1C2')], 1)).status, 'AMBIGUOUS');
  const snapshot = await createRegistryCandidateDirectory(postgresIdentityReader(pools.runtime)).find({
    messageId: 'msg_synthetic', effectiveAt: 1, identifiers: [hex('A0B1C2')], callsign: null });
  assert.equal(snapshot.completeness, 'COMPLETE');
  assert.equal(snapshot.candidates.length, 2);
  assert.equal((await resolve([hex('FFFFFF'), tail('N123AB')], 1)).aircraftId, 'ac_b');
  await commit.append(claim('ac_a', tail('N999ZZ'), 0));
  assert.equal((await resolve([hex('FFFFFF'), tail('N999ZZ')], 1)).aircraftId, 'ac_a');
  assert.equal((await resolve([tail('N999ZZ'), tail('N123AB')], 1)).status, 'CONFLICTED');
});

test('concurrent corrections have one successor and failed transactions leave no revision or replay request', async () => {
  const commit = postgresIdentityCommitter(pools.runtime);
  await commit.createAircraft('ac_a'); await commit.createAircraft('ac_b');
  const first = await commit.append(claim('ac_a', hex('A0B1C2'), 0));
  const results = await Promise.allSettled([
    commit.append(claim('ac_a', hex('A0B1C2'), 0, 100), first.assertionId),
    commit.append(claim('ac_b', hex('A0B1C2'), 0), first.assertionId),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal((await pools.runtime.query('SELECT revision FROM fleet_identity.registry_state')).rows[0].revision, '2');
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM fleet_identity.assertions')).rows[0].n, '2');
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM fleet_identity.replay_requests')).rows[0].n, '3');
  await assert.rejects(() => commit.append(claim('ac_absent', hex('FFFFFF'), 0)), error => error.code === '23503');
  assert.equal((await pools.runtime.query('SELECT revision FROM fleet_identity.registry_state')).rows[0].revision, '2');
  for (const table of ['assertions', 'position_link_revisions'])
    await assert.rejects(() => pools.runtime.query(`UPDATE fleet_identity.${table} SET revision=revision`), error => error.code === '42501');
});

test('unmatched position remains replayable after a later claim', async () => {
  const writer = postgresPositionHistoryWriter(pools.runtime);
  await writer.append(position('late', Date.parse('2026-11-19T10:00:00Z')));
  const linker = postgresPositionLinker(pools.runtime);
  assert.equal((await linker.reevaluate('src_synthetic', 'epoch:synthetic-1:late')).status, 'UNMATCHED');
  const commit = postgresIdentityCommitter(pools.runtime);
  await commit.createAircraft('ac_a');
  await commit.append(claim('ac_a', hex('A0B1C2'), 0));
  const replay = await linker.replayAlias('A0B1C2', 0, Date.parse('2026-11-20T00:00:00Z'), 1);
  assert.equal(replay.decisions[0].aircraftId, 'ac_a');
  const repeat = await Promise.all(Array.from({ length: 4 }, () =>
    linker.reevaluate('src_synthetic', 'epoch:synthetic-1:late')));
  assert.ok(repeat.every(decision => decision.revision === 2));
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM fleet_identity.position_link_revisions')).rows[0].n, '2');
});

test('an upstream confirmed position can link to an existing stable aircraft without a registry alias', async () => {
  const commit = postgresIdentityCommitter(pools.runtime);
  await commit.createAircraft('ac_confirmed');
  const raw = { ...position('confirmed', Date.parse('2026-11-19T10:00:00Z')),
    confirmedAircraftId: 'ac_confirmed',
    identityEvidence: { resolverId: 'synthetic-resolver', evidenceRef: 'synthetic-decision' } };
  const upstream = { status: 'CONFIRMED', sourceId: raw.sourceId,
    sourceObservationId: raw.sourceObservationId, aircraftId: 'ac_confirmed',
    icao24: 'A0B1C2', resolverId: 'synthetic-resolver', evidenceRef: 'synthetic-decision' };
  assert.equal((await postgresPositionHistoryWriter(pools.runtime).append(raw, upstream)).ok, true);
  assert.equal((await postgresPositionLinker(pools.runtime).reevaluate(raw.sourceId,
    raw.sourceObservationId)).aircraftId, 'ac_confirmed');
});

test('permitted synthetic message resolves through registry at observation time and correction preserves facts', async () => {
  const commit = postgresIdentityCommitter(pools.runtime);
  await commit.createAircraft('ac_old'); await commit.createAircraft('ac_new');
  const raw = fixture();
  const observed = Date.parse(raw.sourceObservedAt.at);
  const first = await commit.append(claim('ac_old', hex('D00001'), 0));
  await commit.append(claim('ac_old', tail('DEMO-001'), 0));
  const pipeline = createSyntheticProviderPipeline(pools.runtime, undefined, () => NOW);
  assert.ok((await accept(pipeline, raw)).ok);
  await pipeline.drain();
  const message = (await pools.runtime.query('SELECT message_id,canonical FROM source_ingestion.message_revisions')).rows[0];
  const original = JSON.stringify(message.canonical);
  let decisions = (await pools.runtime.query(`SELECT revision,decision FROM correlation.aircraft_link_revisions
    WHERE message_id=$1 ORDER BY revision`, [message.message_id])).rows;
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decision.aircraftId, 'ac_old');
  assert.equal(observed < NOW, true);
  await commit.append(claim('ac_new', hex('D00001'), 0), first.assertionId);
  const badClock = createIdentityReplayWorker(pools.runtime, () => -1);
  await badClock(1);
  await assert.rejects(badClock(1), /COMMIT_FAILED|Invalid replay clock/);
  assert.equal((await pools.runtime.query(`SELECT phase,cursor_message_id FROM fleet_identity.replay_requests
    ORDER BY request_id DESC LIMIT 1`)).rows[0].cursor_message_id, null);
  await pipeline.drain();
  decisions = (await pools.runtime.query(`SELECT revision,decision FROM correlation.aircraft_link_revisions
    WHERE message_id=$1 ORDER BY revision`, [message.message_id])).rows;
  assert.deepEqual(decisions.map(row => row.decision.status), ['MATCHED', 'CONFLICTED']);
  assert.equal(JSON.stringify((await pools.runtime.query(`SELECT canonical FROM source_ingestion.message_revisions
    WHERE message_id=$1`, [message.message_id])).rows[0].canonical), original);
  assert.equal((await pools.runtime.query(`SELECT revision FROM correlation.aircraft_link_heads
    WHERE message_id=$1`, [message.message_id])).rows[0].revision, '2');
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM correlation.outbox
    WHERE stream_key=$1`, [message.message_id])).rows[0].n, '2');
  assert.equal((await pipeline.readPrivateStatus('ac_old')).freshness, 'NONE');
});

test('adding a second ICAO24 replays the first alias for message status and position links', async () => {
  const commit = postgresIdentityCommitter(pools.runtime);
  await commit.createAircraft('ac_a');
  await commit.append(claim('ac_a', hex('A0B1C2'), 0));
  const raw = fixture();
  raw.aircraft = { icao24: 'A0B1C2' };
  const pipeline = createSyntheticProviderPipeline(pools.runtime, undefined, () => NOW);
  assert.ok((await accept(pipeline, raw)).ok);
  const observedAt = Date.parse(raw.sourceObservedAt.at);
  assert.ok((await postgresPositionHistoryWriter(pools.runtime).append(position('alias-conflict', observedAt))).ok);
  await pipeline.drain();
  const messageId = (await pools.runtime.query('SELECT message_id FROM source_ingestion.message_revisions')).rows[0].message_id;
  const positionId = 'epoch:synthetic-1:alias-conflict';
  assert.equal((await pools.runtime.query(`SELECT r.decision->>'status' AS status FROM correlation.aircraft_link_heads h
    JOIN correlation.aircraft_link_revisions r USING (message_id,revision) WHERE h.message_id=$1`,
  [messageId])).rows[0].status, 'MATCHED');
  assert.equal((await pools.runtime.query(`SELECT r.status FROM fleet_identity.position_link_heads h
    JOIN fleet_identity.position_link_revisions r USING (source_id,source_observation_id,revision)
    WHERE h.source_observation_id=$1`, [positionId])).rows[0].status, 'MATCHED');

  await commit.append(claim('ac_a', hex('D00002'), 0));
  const replay = (await pools.runtime.query(`SELECT normalized_alias FROM fleet_identity.replay_requests
    WHERE assertion_id=(SELECT max(assertion_id) FROM fleet_identity.assertions)
    ORDER BY request_id`)).rows.map(row => row.normalized_alias);
  assert.deepEqual(replay.sort(), ['A0B1C2', 'D00002']);
  await pipeline.drain();
  const decisions = (await pools.runtime.query(`SELECT revision,decision->>'status' AS status
    FROM correlation.aircraft_link_revisions WHERE message_id=$1 ORDER BY revision`, [messageId])).rows;
  assert.deepEqual(decisions.map(row => row.status), ['MATCHED', 'CONFLICTED']);
  assert.equal((await pools.runtime.query(`SELECT revision FROM correlation.aircraft_link_heads
    WHERE message_id=$1`, [messageId])).rows[0].revision, '2');
  assert.equal((await pipeline.readPrivateStatus('ac_a')).freshness, 'NONE');
  const links = (await pools.runtime.query(`SELECT revision,status,aircraft_id FROM fleet_identity.position_link_revisions
    WHERE source_observation_id=$1 ORDER BY revision`, [positionId])).rows;
  assert.deepEqual(links.map(row => row.status), ['MATCHED', 'CONFLICTED']);
  assert.equal(links[1].aircraft_id, null);
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM tracking.position_observations
    WHERE source_observation_id=$1`, [positionId])).rows[0].n, '1');
});

test('bounded replay resumes open-ended ranges and competing position owners without rewriting prior links', async () => {
  const commit = postgresIdentityCommitter(pools.runtime);
  await commit.createAircraft('ac_a'); await commit.createAircraft('ac_b');
  await commit.append(claim('ac_a', hex('A0B1C2'), 0));
  const writer = postgresPositionHistoryWriter(pools.runtime);
  const at = Date.parse('2026-11-19T10:00:00Z');
  for (let i = 0; i < 3; i++) assert.ok((await writer.append(position(`page-${i}`, at + i * 1000))).ok);
  const linker = postgresPositionLinker(pools.runtime);
  for (let i = 0; i < 3; i++) assert.equal((await linker.reevaluate('src_synthetic',
    `epoch:synthetic-1:page-${i}`)).aircraftId, 'ac_a');
  await commit.append(claim('ac_b', hex('A0B1C2'), 0));
  const work = createIdentityReplayWorker(pools.runtime);
  const pages = [];
  for (let i = 0; i < 20; i++) {
    const page = await work(1);
    if (!page) break;
    pages.push(page);
  }
  assert.ok(pages.length > 3);
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM fleet_identity.replay_requests
    WHERE phase <> 'DONE'`)).rows[0].n, '0');
  const links = (await pools.runtime.query(`SELECT source_observation_id,revision,status,aircraft_id,candidate_ids
    FROM fleet_identity.position_link_revisions ORDER BY source_observation_id,revision`)).rows;
  for (let i = 0; i < 3; i++) {
    const history = links.filter(row => row.source_observation_id.endsWith(`page-${i}`));
    assert.deepEqual(history.map(row => row.status), ['MATCHED','AMBIGUOUS']);
    assert.equal(history[0].aircraft_id, 'ac_a');
    assert.equal(history[1].aircraft_id, null);
    assert.deepEqual(history[1].candidate_ids, ['ac_a','ac_b']);
  }
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM tracking.position_observations')).rows[0].n, '3');
  assert.equal(await work(1), null);
});

test('registration correction re-evaluates a historical provider message without changing its source revision', async () => {
  const commit = postgresIdentityCommitter(pools.runtime);
  await commit.createAircraft('ac_first'); await commit.createAircraft('ac_second');
  const originalClaim = await commit.append(claim('ac_first', tail('N123AB'), 0));
  const raw = fixture();
  raw.aircraft = { registration: 'n123ab' };
  const pipeline = createSyntheticProviderPipeline(pools.runtime, undefined, () => NOW);
  assert.ok((await accept(pipeline, raw)).ok);
  await pipeline.drain();
  const message = (await pools.runtime.query('SELECT message_id,canonical FROM source_ingestion.message_revisions')).rows[0];
  assert.equal((await pools.runtime.query(`SELECT decision->>'aircraftId' AS aircraft_id
    FROM correlation.aircraft_link_revisions WHERE message_id=$1`, [message.message_id])).rows[0].aircraft_id, 'ac_first');
  await commit.append(claim('ac_second', tail('N123AB'), 0), originalClaim.assertionId);
  await pipeline.drain();
  const decisions = (await pools.runtime.query(`SELECT revision,decision FROM correlation.aircraft_link_revisions
    WHERE message_id=$1 ORDER BY revision`, [message.message_id])).rows;
  assert.deepEqual(decisions.map(row => row.decision.aircraftId), ['ac_first','ac_second']);
  assert.equal((await pipeline.readPrivateStatus('ac_first')).freshness, 'NONE');
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM source_ingestion.message_revisions
    WHERE message_id=$1`, [message.message_id])).rows[0].n, '1');
  assert.deepEqual((await pools.runtime.query(`SELECT canonical FROM source_ingestion.message_revisions
    WHERE message_id=$1`, [message.message_id])).rows[0].canonical, message.canonical);
});

test('a position appended after alias replay completes receives a durable first decision', async () => {
  const commit = postgresIdentityCommitter(pools.runtime);
  await commit.createAircraft('ac_a');
  await commit.append(claim('ac_a', hex('A0B1C2'), 0));
  const work = createIdentityReplayWorker(pools.runtime);
  while (await work(1)) { /* Drain the assertion request before the position exists. */ }
  const id = 'epoch:synthetic-1:after-replay';
  assert.ok((await postgresPositionHistoryWriter(pools.runtime).append(
    position('after-replay', Date.parse('2026-11-19T10:00:00Z')))).ok);
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM fleet_identity.position_link_heads
    WHERE source_observation_id=$1`, [id])).rows[0].n, '0');
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM fleet_identity.position_link_jobs
    WHERE source_observation_id=$1 AND completed_at IS NULL`, [id])).rows[0].n, '1');
  assert.equal((await work(1)).processed, 1);
  assert.equal((await pools.runtime.query(`SELECT r.aircraft_id FROM fleet_identity.position_link_heads h
    JOIN fleet_identity.position_link_revisions r USING (source_id,source_observation_id,revision)
    WHERE h.source_observation_id=$1`, [id])).rows[0].aircraft_id, 'ac_a');
  assert.equal(await work(1), null);
});

test('insertion during replay and concurrent workers complete with a one-connection pool', async () => {
  const commit = postgresIdentityCommitter(pools.runtime);
  await commit.createAircraft('ac_a');
  await commit.append(claim('ac_a', hex('A0B1C2'), 0));
  const writer = postgresPositionHistoryWriter(pools.runtime);
  const at = Date.parse('2026-11-19T10:00:00Z');
  assert.ok((await writer.append(position('before-page', at))).ok);
  const one = new Pool({ connectionString: process.env.TEST_RUNTIME_DATABASE_URL, max: 1,
    connectionTimeoutMillis: 1000, statement_timeout: 5000 });
  try {
    const work = createIdentityReplayWorker(one);
    await work(1); // Initial position job.
    await work(1); // First assertion position page; request remains open.
    assert.ok((await writer.append(position('during-page', at + 1000))).ok);
    for (let i = 0; i < 12; i++) {
      const pages = await Promise.all([work(1), work(1), work(1)]);
      if (pages.every(page => page === null)) break;
    }
    assert.equal(await work(1), null);
    const rows = (await one.query(`SELECT h.source_observation_id,r.aircraft_id
      FROM fleet_identity.position_link_heads h JOIN fleet_identity.position_link_revisions r
      USING (source_id,source_observation_id,revision) ORDER BY h.source_observation_id`)).rows;
    assert.deepEqual(rows, [
      { source_observation_id: 'epoch:synthetic-1:before-page', aircraft_id: 'ac_a' },
      { source_observation_id: 'epoch:synthetic-1:during-page', aircraft_id: 'ac_a' },
    ]);
    assert.equal((await one.query(`SELECT count(*) AS n FROM fleet_identity.position_link_jobs
      WHERE completed_at IS NULL`)).rows[0].n, '0');
  } finally { await one.end(); }
});

test('correction replay receives work while new position jobs remain pending', async () => {
  const commit = postgresIdentityCommitter(pools.runtime);
  await commit.createAircraft('ac_a');
  await commit.append(claim('ac_a', hex('A0B1C2'), 0));
  const writer = postgresPositionHistoryWriter(pools.runtime);
  const at = Date.parse('2026-11-19T10:00:00Z');
  for (let i = 0; i < 4; i++) assert.ok((await writer.append(position(`fair-${i}`, at + i * 1000))).ok);
  const work = createIdentityReplayWorker(pools.runtime);
  assert.equal((await work(1)).requestId, null);
  const correction = await work(1);
  assert.equal(typeof correction?.requestId, 'number');
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM fleet_identity.position_link_jobs
    WHERE completed_at IS NULL`)).rows[0].n, '3');
  assert.ok((await pools.runtime.query(`SELECT cursor_observation_id FROM fleet_identity.replay_requests
    ORDER BY request_id LIMIT 1`)).rows[0].cursor_observation_id);
  for (let i = 0; i < 30; i++) if (await work(1) === null) break;
  assert.equal(await work(1), null);
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM fleet_identity.replay_requests
    WHERE phase <> 'DONE'`)).rows[0].n, '0');
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM fleet_identity.position_link_jobs
    WHERE completed_at IS NULL`)).rows[0].n, '0');
});
