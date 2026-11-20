import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { createTestPools, resetTestData } from './helpers/database.mjs';
import { icao24, registration, decideAircraftMatch } from '../../src/modules/aircraft-correlation/public/index.ts';
import { createResolveAircraft, createRegistryCandidateDirectory, expandReplayAliases } from '../../src/modules/fleet-identity/public/index.ts';
import { runSqlTransaction } from '../../src/modules/database-transactions/public/index.ts';
import { postgresIdentityReader } from '../../src/modules/fleet-identity/infrastructure/postgres/postgres-identity-reader.ts';
import { postgresIdentityCommitter } from '../../src/modules/fleet-identity/infrastructure/postgres/postgres-identity-committer.ts';
import { postgresPositionLinker } from '../../src/modules/fleet-identity/infrastructure/postgres/postgres-position-linker.ts';
import { postgresReplayRequestReader } from '../../src/modules/fleet-identity/infrastructure/postgres/postgres-replay-request-reader.ts';
import { postgresPositionHistoryWriter } from '../../src/modules/flight-tracking/infrastructure/postgres/append-position.ts';
import { createSyntheticProviderPipeline } from '../../src/modules/source-connectors/composition/create-synthetic-provider-pipeline.ts';
import { createRegistryReplayDelivery } from '../../src/modules/source-connectors/composition/create-permitted-replay-delivery.ts';
import { createIdentityReplayWorker, identityMessageReplayQuery } from '../../src/modules/source-connectors/composition/create-identity-replay-worker.ts';
import { fixture, accept, context, scope, origin, NOW } from './helpers/provider-fixture.mjs';
import { backfillPositionLinks } from '../../../../scripts/postgres/backfill-position-links.mjs';

const pools = createTestPools();
beforeEach(() => resetTestData(pools.admin));
after(() => pools.close());
async function expandAll(limit = 10) {
  let pages = 0;
  while (await runSqlTransaction(pools.runtime, sql => expandReplayAliases(sql, limit))) {
    if (++pages > 1000) throw new Error('Replay expansion did not complete.');
  }
  return pages;
}
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
  await expandAll();
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
  assert.equal((await resolve([hex('FFFFFF'), tail('N123AB')], 1)).status, 'CONFLICTED');
  await commit.append(claim('ac_a', tail('N999ZZ'), 0));
  assert.equal((await resolve([hex('FFFFFF'), tail('N999ZZ')], 1)).status, 'CONFLICTED');
  assert.equal((await resolve([tail('N999ZZ'), tail('N123AB')], 1)).status, 'CONFLICTED');
});

test('cross-source and cross-issuer corrections cannot retire another owner claim', async () => {
  const commit = postgresIdentityCommitter(pools.runtime);
  await commit.createAircraft('ac_a'); await commit.createAircraft('ac_b');
  const first = await commit.append(claim('ac_a', hex('A0B1C2'), 0));
  const competing = { ...claim('ac_b', hex('A0B1C2'), 0), sourceId: 'other-source' };
  await assert.rejects(() => commit.append(competing, first.assertionId),
    /same source and issuer/);
  await assert.rejects(() => commit.append({ ...claim('ac_b', hex('A0B1C2'), 0), issuer: 'other-issuer' },
    first.assertionId), /same source and issuer/);
  assert.equal((await pools.runtime.query('SELECT revision FROM fleet_identity.registry_state')).rows[0].revision, '1');
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM fleet_identity.replay_requests')).rows[0].n, '1');
  await assert.rejects(() => pools.runtime.query(`INSERT INTO fleet_identity.assertions
    (aircraft_id,kind,normalized_alias,valid_from_ms,source_id,issuer,revision,supersedes_id)
    VALUES ('ac_b','ICAO24','A0B1C2',0,'other-source','test',2,$1)`, [first.assertionId]),
  error => error.code === '42501');
  await commit.append(competing);
  const resolve = createResolveAircraft(postgresIdentityReader(pools.runtime));
  assert.deepEqual(await resolve([hex('A0B1C2')], 1),
    { status: 'AMBIGUOUS', candidateIds: ['ac_a', 'ac_b'], revision: 2 });
  const prior = (await postgresIdentityReader(pools.runtime).history('ac_a'))[0];
  assert.equal(prior.supersededAt, null);
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM fleet_identity.assertions')).rows[0].n, '2');
});

test('restricted runtime writes cannot bypass registry revision and correction replay', async () => {
  const commit = postgresIdentityCommitter(pools.runtime);
  await commit.createAircraft('ac_guarded');
  for (const sql of [
    `INSERT INTO fleet_identity.assertions
      (aircraft_id,kind,normalized_alias,valid_from_ms,source_id,issuer,revision)
      VALUES ('ac_guarded','ICAO24','A0B1C2',0,'synthetic','test',1)`,
    'UPDATE fleet_identity.registry_state SET revision=1 WHERE singleton',
    `INSERT INTO fleet_identity.replay_expansions
      (assertion_id,aircraft_id,valid_from_ms) VALUES (1,'ac_guarded',0)`,
  ]) await assert.rejects(() => pools.runtime.query(sql), error => error.code === '42501');
  assert.equal((await pools.runtime.query('SELECT revision FROM fleet_identity.registry_state')).rows[0].revision, '0');
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM fleet_identity.assertions')).rows[0].n, '0');
  const first = await commit.append(claim('ac_guarded', hex('A0B1C2'), 0));
  assert.equal(first.revision, 1);
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM fleet_identity.replay_requests')).rows[0].n, '1');
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM fleet_identity.replay_expansions')).rows[0].n, '1');
});

test('more than 1,000 active assertions produce a complete registry decision', async () => {
  await postgresIdentityCommitter(pools.runtime).createAircraft('ac_populated');
  await pools.admin.query(`INSERT INTO fleet_identity.assertions
    (aircraft_id,kind,normalized_alias,valid_from_ms,source_id,issuer,revision)
    SELECT 'ac_populated','ICAO24','A0B1C2',0,'synthetic','test',n
    FROM generate_series(1,1201) AS n`);
  await pools.admin.query('UPDATE fleet_identity.registry_state SET revision=1201 WHERE singleton');
  const reader = postgresIdentityReader(pools.runtime);
  const snapshot = await reader.find([hex('A0B1C2')], 1);
  assert.equal(snapshot.completeness, 'COMPLETE');
  assert.equal(snapshot.assertions.length, 1);
  assert.deepEqual(await createResolveAircraft(reader)([hex('A0B1C2')], 1),
    { status: 'MATCHED', aircraftId: 'ac_populated', revision: 1201 });
  const candidates = await createRegistryCandidateDirectory(reader).find({
    messageId: 'msg_populated', effectiveAt: 1, identifiers: [hex('A0B1C2')], callsign: null });
  assert.equal(candidates.completeness, 'COMPLETE');
  assert.equal(candidates.candidates.length, 1);
  assert.equal(candidates.candidates[0].aliases.length, 1);
  let pages = 0;
  const changingReader = postgresIdentityReader({ async query(sql, parameters) {
    const result = await pools.runtime.query(sql, parameters);
    if (++pages === 1)
      await pools.admin.query('UPDATE fleet_identity.registry_state SET revision=revision+1 WHERE singleton');
    return result;
  } });
  const changed = await changingReader.find([hex('A0B1C2')], 1);
  assert.equal(pages, 1);
  assert.equal(changed.completeness, 'COMPLETE');
  assert.equal(changed.revision, 1201);
});

test('duplicate active claims stay bounded and resolve completely after 2,000 assertions', async () => {
  await postgresIdentityCommitter(pools.runtime).createAircraft('ac_oversized');
  await pools.admin.query(`INSERT INTO fleet_identity.assertions
    (aircraft_id,kind,normalized_alias,valid_from_ms,source_id,issuer,revision)
    SELECT 'ac_oversized','ICAO24','A0B1C2',0,'synthetic','test',n
    FROM generate_series(1,2000) AS n`);
  await pools.admin.query('UPDATE fleet_identity.registry_state SET revision=2000 WHERE singleton');
  let rowsRead = 0;
  let pages = 0;
  const reader = postgresIdentityReader({ async query(sql, parameters) {
    const result = await pools.runtime.query(sql, parameters);
    rowsRead += result.rows.length;
    pages++;
    return result;
  } });
  const atLimit = await reader.find([hex('A0B1C2')], 1);
  assert.equal(atLimit.completeness, 'COMPLETE');
  assert.equal(atLimit.assertions.length, 1);
  await pools.admin.query(`INSERT INTO fleet_identity.assertions
    (aircraft_id,kind,normalized_alias,valid_from_ms,source_id,issuer,revision)
    SELECT 'ac_oversized','ICAO24','A0B1C2',0,'synthetic','test',n
    FROM generate_series(2001,2501) AS n`);
  await pools.admin.query('UPDATE fleet_identity.registry_state SET revision=2501 WHERE singleton');
  rowsRead = 0;
  pages = 0;
  const snapshot = await reader.find([hex('A0B1C2')], 1);
  assert.equal(snapshot.completeness, 'COMPLETE');
  assert.equal(snapshot.assertions.length, 1);
  assert.equal(rowsRead, 1);
  assert.equal(pages, 1);
  assert.deepEqual(await createResolveAircraft(reader)([hex('A0B1C2')], 1),
    { status: 'MATCHED', aircraftId: 'ac_oversized', revision: 2501 });
  const candidates = await createRegistryCandidateDirectory(reader).find({
    messageId: 'msg_oversized', effectiveAt: 1, identifiers: [hex('A0B1C2')], callsign: null });
  assert.equal(candidates.completeness, 'COMPLETE');
  assert.equal(candidates.candidates.length, 1);
  assert.equal(candidates.candidates[0].aliases.length, 1);
});

test('distinct active aliases retain the conflict veto with bounded evidence', async () => {
  await postgresIdentityCommitter(pools.runtime).createAircraft('ac_many_aliases');
  await pools.admin.query(`INSERT INTO fleet_identity.assertions
    (aircraft_id,kind,normalized_alias,valid_from_ms,source_id,issuer,revision)
    SELECT 'ac_many_aliases','ICAO24',upper(lpad(to_hex(n),6,'0')),0,'synthetic','test',n
    FROM generate_series(1,2501) AS n`);
  await pools.admin.query('UPDATE fleet_identity.registry_state SET revision=2501 WHERE singleton');
  const reader = postgresIdentityReader(pools.runtime);
  const snapshot = await reader.find([hex('000001')], 1);
  assert.equal(snapshot.completeness, 'COMPLETE');
  assert.equal(snapshot.assertions.length, 2);
  assert.equal((await createResolveAircraft(reader)([hex('000001')], 1)).status, 'CONFLICTED');
  const candidates = await createRegistryCandidateDirectory(reader).find({
    messageId: 'msg_many_aliases', effectiveAt: 1, identifiers: [hex('000001')], callsign: null });
  assert.equal(candidates.completeness, 'COMPLETE');
  assert.equal(decideAircraftMatch({ messageId: 'msg_many_aliases', effectiveAt: 1,
    identifiers: [hex('000001')], callsign: null }, candidates.candidates).status, 'CONFLICTED');
});

test('an oversized owner set blocks only its replay request and resumes after correction', async () => {
  const commit = postgresIdentityCommitter(pools.runtime);
  await commit.createAircraft('ac_original');
  const original = await commit.append(claim('ac_original', hex('D00001'), 0));
  const raw = fixture();
  raw.aircraft = { icao24: 'D00001' };
  const pipeline = createSyntheticProviderPipeline(pools.runtime, undefined, () => NOW);
  assert.ok((await accept(pipeline, raw)).ok);
  await pipeline.drain();
  await pools.admin.query(`INSERT INTO fleet_identity.aircraft (aircraft_id)
    SELECT 'ac_bulk-'||lpad(n::text,4,'0') FROM generate_series(1,2000) n`);
  await pools.admin.query(`INSERT INTO fleet_identity.assertions
    (aircraft_id,kind,normalized_alias,valid_from_ms,source_id,issuer,revision)
    SELECT 'ac_bulk-'||lpad(n::text,4,'0'),'ICAO24','D00001',0,'synthetic','test',n+1
    FROM generate_series(1,2000) n`);
  await pools.admin.query('UPDATE fleet_identity.registry_state SET revision=2001 WHERE singleton');
  await pools.admin.query(`INSERT INTO fleet_identity.replay_requests
    (assertion_id,kind,normalized_alias,valid_from_ms,phase)
    VALUES ($1,'ICAO24','D00001',0,'MESSAGES')`, [original.assertionId]);
  await pools.admin.query(`INSERT INTO fleet_identity.replay_requests
    (assertion_id,kind,normalized_alias,valid_from_ms,phase)
    VALUES ($1,'ICAO24','FFFFFF',0,'MESSAGES')`, [original.assertionId]);
  const requests = (await pools.runtime.query(`SELECT request_id FROM fleet_identity.replay_requests
    WHERE phase <> 'DONE' ORDER BY request_id`)).rows.map(row => Number(row.request_id));
  const work = createIdentityReplayWorker(pools.runtime);
  for (let i = 0; i < 10; i++) {
    await work(1);
    const phases = (await pools.runtime.query(`SELECT phase FROM fleet_identity.replay_requests
      ORDER BY request_id`)).rows.map(row => row.phase);
    if (phases[0] === 'BLOCKED' && phases[1] === 'DONE') break;
  }
  const blocked = (await pools.runtime.query(`SELECT phase,blocked_revision,cursor_message_id
    FROM fleet_identity.replay_requests WHERE request_id=$1`, [requests[0]])).rows[0];
  assert.equal(blocked.phase, 'BLOCKED');
  assert.equal(blocked.blocked_revision, '2001');
  assert.equal(blocked.cursor_message_id, null);
  assert.equal((await pools.runtime.query(`SELECT phase FROM fleet_identity.replay_requests
    WHERE request_id=$1`, [requests[1]])).rows[0].phase, 'DONE');
  await pools.admin.query(`INSERT INTO fleet_identity.assertions
    (aircraft_id,kind,normalized_alias,valid_from_ms,source_id,issuer,revision,supersedes_id)
    SELECT aircraft_id,kind,normalized_alias,$1,source_id,issuer,revision+2000,assertion_id
    FROM fleet_identity.assertions WHERE aircraft_id LIKE 'ac_bulk-%' AND supersedes_id IS NULL`,
  [NOW + 1]);
  await pools.admin.query('UPDATE fleet_identity.registry_state SET revision=4001 WHERE singleton');
  for (let i = 0; i < 10; i++) {
    await work(1);
    if ((await pools.runtime.query(`SELECT phase FROM fleet_identity.replay_requests
      WHERE request_id=$1`, [requests[0]])).rows[0].phase === 'DONE') break;
  }
  assert.equal((await pools.runtime.query(`SELECT phase FROM fleet_identity.replay_requests
    WHERE request_id=$1`, [requests[0]])).rows[0].phase, 'DONE');
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM fleet_identity.assertions`)).rows[0].n, '4001');
});

test('registry resolution rejects an unowned registration that contradicts the ICAO owner', async () => {
  const commit = postgresIdentityCommitter(pools.runtime);
  await commit.createAircraft('ac_a');
  await commit.append(claim('ac_a', hex('A0B1C2'), 0));
  await commit.append(claim('ac_a', tail('N123AB'), 0));
  const reader = postgresIdentityReader(pools.runtime);
  const resolve = createResolveAircraft(reader);
  assert.deepEqual(await resolve([hex('A0B1C2'), tail('N999ZZ')], 1),
    { status: 'CONFLICTED', candidateIds: ['ac_a'], revision: 2 });
  const input = { messageId: 'msg_synthetic', effectiveAt: 1,
    identifiers: [hex('A0B1C2'), tail('N999ZZ')], callsign: null };
  const snapshot = await createRegistryCandidateDirectory(reader).find(input);
  assert.equal(snapshot.completeness, 'COMPLETE');
  assert.equal(decideAircraftMatch(input, snapshot.candidates).status, 'CONFLICTED');
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

test('large registry append stays bounded and expansion resumes after a failed page', async () => {
  await pools.runtime.query("INSERT INTO fleet_identity.aircraft (aircraft_id) VALUES ('ac_large')");
  await pools.admin.query(`INSERT INTO fleet_identity.assertions
    (aircraft_id,kind,normalized_alias,valid_from_ms,source_id,issuer,revision)
    SELECT 'ac_large','REGISTRATION','N'||lpad(n::text,5,'0'),0,'synthetic','test',n
    FROM generate_series(1,250) n`);
  await pools.admin.query('UPDATE fleet_identity.registry_state SET revision=250 WHERE singleton');
  const commit = postgresIdentityCommitter(pools.runtime);
  const assertion = await commit.append(claim('ac_large', hex('A0B1C2'), 0));
  assert.equal(assertion.revision, 251);
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM fleet_identity.replay_requests')).rows[0].n, '1');
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM fleet_identity.replay_expansions')).rows[0].n, '1');
  await assert.rejects(() => runSqlTransaction(pools.runtime, async sql => {
    const page = await expandReplayAliases(sql, 25);
    assert.equal(page.processed, 25);
    throw new Error('Synthetic expansion rollback');
  }), /Synthetic expansion rollback/);
  assert.equal((await pools.runtime.query('SELECT cursor_assertion_id FROM fleet_identity.replay_expansions')).rows[0].cursor_assertion_id, '0');
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM fleet_identity.replay_requests')).rows[0].n, '1');
  const first = await runSqlTransaction(pools.runtime, sql => expandReplayAliases(sql, 25));
  assert.equal(first.processed, 25);
  assert.equal(first.complete, false);
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM fleet_identity.replay_requests')).rows[0].n, '26');
  assert.equal(await expandAll(25), 10);
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM fleet_identity.replay_requests')).rows[0].n, '251');
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM fleet_identity.assertions')).rows[0].n, '251');
  assert.ok((await pools.runtime.query('SELECT completed_at FROM fleet_identity.replay_expansions')).rows[0].completed_at);
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
  const { delivery, pipeline } = createRegistryReplayDelivery(pools.runtime,
    { ...scope, retentionAllowed: true, purpose: 'PRIVATE_PROCESSING',
      evidenceReference: 'repository-synthetic-fixtures-only' }, scope,
    context, () => origin, () => NOW);
  assert.ok((await delivery.accept(raw)).ok);
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
  await assert.rejects(async () => {
    for (let page = 0; page < 30; page++) await badClock(1);
    throw new Error('Replay did not reach the synthetic message.');
  }, /COMMIT_FAILED|Invalid replay clock/);
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
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM fleet_identity.replay_requests
    WHERE assertion_id=(SELECT max(assertion_id) FROM fleet_identity.assertions)`)).rows[0].n, '1');
  await expandAll();
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

test('expired aliases do not exhaust the active candidate limit and history is paged', async () => {
  await postgresIdentityCommitter(pools.runtime).createAircraft('ac_history');
  await pools.admin.query(`INSERT INTO fleet_identity.assertions
    (aircraft_id,kind,normalized_alias,valid_from_ms,valid_until_ms,source_id,issuer,revision)
    SELECT 'ac_history','ICAO24',lpad(upper(to_hex(n)),6,'0'),n*1000,n*1000+500,
      'synthetic','test',n FROM generate_series(1,1200) AS n`);
  await pools.admin.query(`INSERT INTO fleet_identity.assertions
    (aircraft_id,kind,normalized_alias,valid_from_ms,source_id,issuer,revision)
    VALUES ('ac_history','ICAO24','A0B1C2',1201000,'synthetic','test',1201)`);
  await pools.admin.query('UPDATE fleet_identity.registry_state SET revision=1201 WHERE singleton');
  const reader = postgresIdentityReader(pools.runtime);
  assert.deepEqual(await createResolveAircraft(reader)([hex('A0B1C2')], 1201001),
    { status: 'MATCHED', aircraftId: 'ac_history', revision: 1201 });
  const first = await reader.history('ac_history', 0, 500);
  const second = await reader.history('ac_history', first.at(-1).assertionId, 500);
  const third = await reader.history('ac_history', second.at(-1).assertionId, 500);
  assert.deepEqual([first.length, second.length, third.length], [500, 500, 201]);
  assert.equal(third.at(-1).identifier.value, 'A0B1C2');
  await assert.rejects(reader.history('ac_history', 0, 501), /History page size/);
});

test('message correction lookup uses fixed-path indexes on populated retained messages', async () => {
  const total = 8000;
  await pools.admin.query(`INSERT INTO source_ingestion.deliveries
    (delivery_id,source_id,provider_id,account_scope,source_epoch,external_id,payload_sha256,
     data_level,schema_version,capabilities_revision,received_at_ms,received_basis,
     received_precision,received_uncertainty_ms,observed_at_ms,observed_basis,
     observed_precision,observed_uncertainty_ms,retrieved_at_ms,ingested_at_ms,provenance,state)
    SELECT md5('identity-plan-'||n)::uuid,'src_synthetic','synthetic','private-fixture','v1',
      'plan-'||n,repeat('a',64),'PROVIDER_MESSAGE',1,1,1000000+n,'RECEIVED',
      'SECOND',0,1000000+n,'OBSERVED','SECOND',0,1000000+n,1000000+n,
      '{"pageUrl":"https://synthetic.example/plan","parserVersion":"fixture-v1"}'::jsonb,'ACCEPTED'
    FROM generate_series(1,$1::integer) AS n`, [total]);
  await pools.admin.query(`INSERT INTO source_ingestion.retained_inputs (delivery_id,canonical,permission)
    SELECT md5('identity-plan-'||n)::uuid,
      jsonb_build_object('observation',jsonb_build_object('sourceId','src_synthetic',
        'sourceDeliveryId',jsonb_build_object('provider','synthetic','accountScope','private-fixture',
          'sourceEpoch','v1'),'observedAt',jsonb_build_object('at',(1000000+n)::text)),
        'aircraftHints',jsonb_build_object('icao24',CASE WHEN n=$1 THEN 'A0B1C2' ELSE 'D00001' END,
          'registration',CASE WHEN n=$1 THEN 'N123AB' ELSE 'N999ZZ' END)),
      '{"sourceId":"src_synthetic","provider":"synthetic","accountScope":"private-fixture",
        "sourceEpoch":"v1","purpose":"PRIVATE_PROCESSING","retentionAllowed":true,
        "evidenceReference":"repository-synthetic-fixtures-only"}'::jsonb
    FROM generate_series(1,$1::integer) AS n`, [total]);
  await pools.admin.query(`INSERT INTO source_ingestion.message_revisions
    (message_id,revision,source_delivery_id,transformation_id,canonical)
    SELECT 'msg_plan-'||n,1,ri.delivery_id,'provider-message/1',ri.canonical
    FROM generate_series(1,$1::integer) AS n
    JOIN source_ingestion.retained_inputs ri ON ri.delivery_id=md5('identity-plan-'||n)::uuid`, [total]);
  await pools.admin.query('ANALYZE source_ingestion.message_revisions');
  for (const [kind, alias, index] of [
    ['ICAO24', 'A0B1C2', 'message_identity_icao24_time'],
    ['REGISTRATION', 'N123AB', 'message_identity_registration_time'],
  ]) {
    const plan = (await pools.admin.query(`EXPLAIN (FORMAT JSON) ${identityMessageReplayQuery(kind)}`,
      [alias, 1000000, null, null, null, 100])).rows[0]['QUERY PLAN'];
    assert.match(JSON.stringify(plan), new RegExp(index));
  }
});

test('correction replay receives work while new position jobs remain pending', async () => {
  const commit = postgresIdentityCommitter(pools.runtime);
  await commit.createAircraft('ac_a');
  await commit.append(claim('ac_a', hex('A0B1C2'), 0));
  const writer = postgresPositionHistoryWriter(pools.runtime);
  const at = Date.parse('2026-11-19T10:00:00Z');
  for (let i = 0; i < 12; i++) assert.ok((await writer.append(position(`fair-${i}`, at + i * 1000))).ok);
  const work = createIdentityReplayWorker(pools.runtime);
  assert.equal((await work(1)).requestId, null);
  let correctionPage;
  for (let i = 0; i < 20; i++) {
    const page = await work(1);
    const cursor = (await pools.runtime.query(`SELECT cursor_observation_id
      FROM fleet_identity.replay_requests ORDER BY request_id LIMIT 1`)).rows[0].cursor_observation_id;
    if (cursor) { correctionPage = page; break; }
  }
  assert.equal(typeof correctionPage?.requestId, 'number');
  const pending = Number((await pools.runtime.query(`SELECT count(*) AS n
    FROM fleet_identity.position_link_jobs WHERE completed_at IS NULL`)).rows[0].n);
  assert.ok(pending > 0 && pending < 12);
  for (let i = 0; i < 80; i++) if (await work(1) === null) break;
  assert.equal(await work(1), null);
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM fleet_identity.replay_requests
    WHERE phase <> 'DONE'`)).rows[0].n, '0');
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM fleet_identity.position_link_jobs
    WHERE completed_at IS NULL`)).rows[0].n, '0');
});

test('position backfill commits bounded pages and resumes without duplicate jobs', async () => {
  await pools.admin.query('ALTER TABLE tracking.position_observations DISABLE TRIGGER enqueue_position_link');
  try {
    const writer = postgresPositionHistoryWriter(pools.runtime);
    for (let i = 0; i < 3; i++) assert.ok((await writer.append(position(`legacy-${i}`, NOW + i))).ok);
  } finally {
    await pools.admin.query('ALTER TABLE tracking.position_observations ENABLE TRIGGER enqueue_position_link');
  }
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM fleet_identity.position_link_jobs')).rows[0].n, '0');
  assert.deepEqual(await backfillPositionLinks(pools.admin, { batchSize: 1, maxBatches: 1 }),
    { queued: 1, complete: false });
  assert.equal((await pools.admin.query(`SELECT last_source_observation_id FROM fleet_identity.position_backfill_progress`))
    .rows[0].last_source_observation_id, 'epoch:synthetic-1:legacy-0');
  await pools.admin.query(`CREATE FUNCTION fleet_identity.reject_synthetic_backfill() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.source_observation_id = 'epoch:synthetic-1:legacy-1' THEN
        RAISE EXCEPTION 'synthetic backfill failure';
      END IF;
      RETURN NEW;
    END $$`);
  await pools.admin.query(`CREATE TRIGGER reject_synthetic_backfill BEFORE INSERT
    ON fleet_identity.position_link_jobs FOR EACH ROW
    EXECUTE FUNCTION fleet_identity.reject_synthetic_backfill()`);
  try {
    await assert.rejects(backfillPositionLinks(pools.admin, { batchSize: 1, maxBatches: 1 }),
      /synthetic backfill failure/);
    assert.equal((await pools.admin.query(`SELECT last_source_observation_id
      FROM fleet_identity.position_backfill_progress`)).rows[0].last_source_observation_id,
    'epoch:synthetic-1:legacy-0');
  } finally {
    await pools.admin.query('DROP TRIGGER reject_synthetic_backfill ON fleet_identity.position_link_jobs');
    await pools.admin.query('DROP FUNCTION fleet_identity.reject_synthetic_backfill()');
  }
  assert.deepEqual(await backfillPositionLinks(pools.admin, { batchSize: 1 }),
    { queued: 2, complete: true });
  assert.deepEqual(await backfillPositionLinks(pools.admin, { batchSize: 1 }),
    { queued: 0, complete: true });
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM fleet_identity.position_link_jobs')).rows[0].n, '3');
  const work = createIdentityReplayWorker(pools.runtime);
  while (await work(1)) { /* All pre-existing facts receive a decision. */ }
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM fleet_identity.position_link_heads`)).rows[0].n, '3');
});

test('populated registry uses the alias and time index for owner lookup', async () => {
  await pools.admin.query(`INSERT INTO fleet_identity.aircraft (aircraft_id)
    SELECT 'ac_plan-' || n FROM generate_series(1,3000) AS n`);
  await pools.admin.query(`INSERT INTO fleet_identity.assertions
    (aircraft_id,kind,normalized_alias,valid_from_ms,source_id,issuer,revision)
    SELECT 'ac_plan-' || n,'ICAO24',upper(lpad(to_hex(n),6,'0')),0,'synthetic','plan',n
    FROM generate_series(1,3000) AS n`);
  await pools.admin.query('ANALYZE fleet_identity.assertions');
  let actualLookup;
  const reader = postgresIdentityReader({ query(sql, parameters) {
    actualLookup = { sql, parameters };
    return pools.runtime.query(sql, parameters);
  } });
  const snapshot = await reader.find([hex('000BB8')], NOW);
  assert.equal(snapshot.assertions[0].aircraftId, 'ac_plan-3000');
  const plan = (await pools.admin.query(`EXPLAIN (FORMAT JSON) ${actualLookup.sql}`,
    actualLookup.parameters)).rows[0]['QUERY PLAN'];
  assert.match(JSON.stringify(plan), /assertions_alias_time/);
});
