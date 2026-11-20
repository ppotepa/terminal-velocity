import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestPools, resetTestData } from './helpers/database.mjs';
import { icao24, registration } from '../../src/modules/aircraft-correlation/public/index.ts';
import { createResolveAircraft, createRegistryCandidateDirectory } from '../../src/modules/fleet-identity/public/index.ts';
import { postgresIdentityReader } from '../../src/modules/fleet-identity/infrastructure/postgres/postgres-identity-reader.ts';
import { postgresIdentityCommitter } from '../../src/modules/fleet-identity/infrastructure/postgres/postgres-identity-committer.ts';
import { postgresPositionLinker } from '../../src/modules/fleet-identity/infrastructure/postgres/postgres-position-linker.ts';
import { postgresReplayRequestReader } from '../../src/modules/fleet-identity/infrastructure/postgres/postgres-replay-request-reader.ts';
import { postgresPositionHistoryWriter } from '../../src/modules/flight-tracking/infrastructure/postgres/append-position.ts';

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
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM fleet_identity.replay_requests`)).rows[0].n, '4');
  assert.equal((await pools.runtime.query(`SELECT count(*) AS n FROM fleet_identity.assertions`)).rows[0].n, '3');
  const history = await reader.history('ac_a');
  assert.equal(history.length, 1);
  assert.equal(history[0].assertionId, prior.assertionId);
  assert.ok(history[0].supersededAt);
  const requests = await postgresReplayRequestReader(pools.runtime).list(0, 10);
  assert.equal(requests.length, 4);
  assert.deepEqual(requests.slice(-2).map(request => request.validUntil), [boundary, null]);
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
