import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { applyMigrations } from '../../../../scripts/postgres/migrate.mjs';
import { createTestDatabase } from '../../../../scripts/postgres/test-database.mjs';
import { trackPoolShutdown } from '../../../../scripts/postgres/drain-pool.mjs';
import { parseSourceObservation } from '../../src/modules/source-connectors/public/index.ts';
import { postgresSourceDeliveryStore } from '../../src/modules/source-connectors/infrastructure/postgres/postgres-source-delivery-store.ts';
import { createTestPools, uniqueId } from './helpers/database.mjs';
import { createDecisionEvent } from './helpers/decisions.mjs';
import { createPostgresEventDelivery } from '../../src/modules/event-delivery/infrastructure/postgres-event-delivery.ts';

const pools = createTestPools();
const store = postgresSourceDeliveryStore(pools.runtime);
after(() => pools.close());

const receipt = { at: '2026-11-19T11:00:00Z', basis: 'RECEIVED', precision: 'SECOND', uncertaintyMs: 50 };
const origin = {
  pageUrl: 'https://synthetic.example/aircraft/abc?session=discard#private',
  retrievedAt: Date.parse(receipt.at) + 1000, ingestedAt: Date.parse(receipt.at) + 1100, parserVersion: 'fixture-v1',
};
const accepted = { state: 'ACCEPTED' };

function observation(details = {}) {
  const input = {
    schemaVersion: 1, sourceId: 'src_synthetic', payloadDigest: 'a'.repeat(64), capabilitiesRevision: 1,
    sourceDeliveryId: { provider: 'fixture', accountScope: 'private', sourceEpoch: 'session', externalId: uniqueId('delivery') },
    receivedAt: receipt, ...details,
  };
  if (!input.dataLevel) Object.assign(input, { dataLevel: 'PROVIDER_MESSAGE', decodedText: 'Fixture content' });
  const result = parseSourceObservation(input);
  assert.ok(result.ok);
  return result.value;
}
function key(value) { return { sourceId: value.sourceId, identity: value.sourceDeliveryId }; }

test('a baseline database upgrades once to source storage and preserves its migration checksum and records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tv-baseline-'));
  const first = '001_durable_correlation.sql';
  let database, pool, closePool;
  try {
    await copyFile(new URL('../../../../db/migrations/' + first, import.meta.url), join(dir, first));
    database = await createTestDatabase(process.env.TEST_DATABASE_URL, dir);
    pool = new Pool({ connectionString: database.adminUrl, max: 1 });
    closePool = trackPoolShutdown(pool);
    const history = () => pool.query('SELECT * FROM tv_migrations.applied WHERE name=$1', [first]);
    const before = (await history()).rows;
    assert.equal(before.length, 1);
    const message = uniqueId('msg');
    await pool.query('INSERT INTO message_ingestion.messages VALUES ($1,$2,1,1)',
      [message, { messageId: message, observedAt: 1 }]);
    const event = await createDecisionEvent(pool);
    await pool.query(`INSERT INTO event_delivery.deliveries(consumer_id,event_id) VALUES ('upgrade-private-test',$1)`, [event.eventId]);
    assert.deepEqual(await applyMigrations(pool), ['002_source_deliveries.sql', '003_source_acceptance_fingerprint.sql',
      '004_source_event_delivery_bridge.sql', '005_permitted_source_retention.sql', '006_source_replay.sql',
      '007_tracking_position_history.sql', '008_fleet_identity.sql', '009_fleet_identity_replay_progress.sql',
      '010_fleet_identity_position_jobs.sql', '011_fleet_identity_correction_authority.sql',
      '012_fleet_identity_scheduling.sql']);
    const queue = createPostgresEventDelivery(pool);
    const lease = await queue.leaseNext('upgrade-private-test', 30_000);
    assert.equal(lease.eventId, event.eventId);
    let delivered;
    assert.equal(await queue.consume(lease, async (_sql, input) => { delivered = input; }), 'APPLIED');
    assert.deepEqual(delivered, event);
    assert.equal((await pool.query('SELECT correlation_event_id FROM event_delivery.events WHERE event_id=$1',
      [event.eventId])).rows[0].correlation_event_id, event.eventId);
    assert.deepEqual(await applyMigrations(pool), []);
    assert.deepEqual((await history()).rows, before);
    assert.equal((await pool.query('SELECT * FROM message_ingestion.messages WHERE message_id=$1', [message])).rowCount, 1);
  } finally {
    if (closePool) await closePool();
    if (database) await database.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('an independent pool reads provider provenance, metadata-only retention and distinct retrieval time', async () => {
  const item = observation({ decoderVersion: 'v2' });
  const id = await store.appendDelivery(item, origin, accepted);
  const independent = createTestPools();
  try {
    const saved = await postgresSourceDeliveryStore(independent.runtime).findDelivery(key(item));
    assert.equal(saved.deliveryId, id);
    assert.deepEqual(saved.identity, item.sourceDeliveryId);
    assert.equal(saved.retention, 'METADATA_ONLY');
    assert.equal(saved.pageUrl, 'https://synthetic.example/aircraft/abc');
    assert.equal(saved.parserVersion, origin.parserVersion);
    assert.equal(saved.retrievedAt, origin.retrievedAt);
    assert.equal(saved.ingestedAt, origin.ingestedAt);
    assert.equal(saved.decoderVersion, 'v2');
    assert.deepEqual(saved.receivedAt, { at: Date.parse(receipt.at), basis: 'RECEIVED', precision: 'SECOND', uncertaintyMs: 50 });
    assert.equal(saved.observedAt, null);
    assert.deepEqual(saved.providerMessage, { direction: null, bearer: null });
    assert.equal(saved.reception, null);
    assert.equal(JSON.stringify(saved).includes('Fixture content'), false);
    assert.deepEqual(saved.disposition, accepted);
  } finally { await independent.close(); }
  await assert.rejects(store.appendDelivery(item, { ...origin, pageUrl: 'https://user:password@synthetic.example/' }, accepted),
    /Invalid source page location/);
});

test('scoped identity rejects repeat keys including changed content and permits distinct accounts or sources', async () => {
  const item = observation();
  await store.appendDelivery(item, origin, accepted);
  for (const digest of [item.payloadDigest, 'b'.repeat(64)])
    await assert.rejects(store.appendDelivery({ ...item, payloadDigest: digest }, origin, accepted), { code: '23505' });
  for (const separate of [{ ...item, sourceId: 'src_other' },
    { ...item, sourceDeliveryId: { ...item.sourceDeliveryId, accountScope: 'other' } }])
    await store.appendDelivery(separate, origin, accepted);
  assert.equal((await store.findDelivery(key(item))).payloadDigest, item.payloadDigest);
});

test('concurrent first inserts commit exactly one coherent delivery across independent pools', async () => {
  const other = createTestPools();
  const contender = postgresSourceDeliveryStore(other.runtime);
  const first = observation({ bearer: 'VDL2' });
  const second = { ...first, payloadDigest: 'b'.repeat(64), bearer: 'HF' };
  try {
    const outcomes = await Promise.allSettled([
      store.appendDelivery(first, origin, accepted), contender.appendDelivery(second, origin, accepted),
    ]);
    const winners = outcomes.filter(result => result.status === 'fulfilled');
    const losers = outcomes.filter(result => result.status === 'rejected');
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(losers[0].reason.code, '23505');
    const expected = outcomes[0].status === 'fulfilled' ? first : second;
    const saved = await contender.findDelivery(key(first));
    assert.equal(saved.deliveryId, winners[0].value);
    assert.equal(saved.payloadDigest, expected.payloadDigest);
    assert.equal(saved.providerMessage.bearer, expected.bearer);
    const { rowCount } = await other.runtime.query(
      'SELECT FROM source_ingestion.provider_message_observations WHERE delivery_id=$1', [saved.deliveryId]);
    assert.equal(rowCount, 1);
  } finally { await other.close(); }
});

test('actual receiver evidence is separate from provider facts; malformed subtype writes roll back completely', async () => {
  const item = observation({ dataLevel: 'RECEPTION', receiverId: 'fixture-station', signalStrengthDbm: 0,
    observedAt: { ...receipt, basis: 'OBSERVED' } });
  const disposition = { state: 'QUARANTINED', reason: 'fixture-case' };
  await store.appendDelivery(item, origin, disposition);
  const saved = await store.findDelivery(key(item));
  assert.deepEqual(saved.reception, { receiverId: 'fixture-station', frequencyHz: null, signalStrengthDbm: 0 });
  assert.equal(saved.providerMessage, null);
  assert.deepEqual(saved.disposition, disposition);
  assert.equal(saved.observedAt.at, Date.parse(receipt.at));
  await assert.rejects(pools.runtime.query('INSERT INTO source_ingestion.provider_message_observations(delivery_id) VALUES ($1)',
    [saved.deliveryId]), { code: '23503' });
  const invalid = observation({ dataLevel: 'RECEPTION', receiverId: 'one' });
  await assert.rejects(store.appendDelivery({ ...invalid, frequencyHz: -1 }, origin, accepted), { code: '23514' });
  assert.equal(await store.findDelivery(key(invalid)), null);
});

test('PostgreSQL enforces provenance, time, digest and level constraints even on direct SQL', async () => {
  const frame = observation({ dataLevel: 'FRAME', frameBytesBase64: 'AQID' });
  const id = await store.appendDelivery(frame, origin, accepted);
  const saved = await store.findDelivery(key(frame));
  assert.equal(saved.providerMessage, null);
  assert.equal(saved.reception, null);
  for (const [column, invalid] of [
    ['received_at_ms', -1], ['observed_basis', 'OBSERVED'], ['data_level', 'invented'], ['payload_sha256', 'a'],
    ['provenance', '{}'], ['provenance', '[]'], ['provenance', '{"pageUrl":"https://x/?key=x","parserVersion":"v1"}'],
    ['quarantine_reason', 'invalid-for-accepted'], ['retention', 'FULL'],
  ]) await assert.rejects(pools.admin.query(`UPDATE source_ingestion.deliveries SET ${column}=$2 WHERE delivery_id=$1`,
    [id, invalid]), { code: '23514' });
});

test('source owner and runtime grants protect immutable facts and source events remain independent', async () => {
  const { rows } = await pools.admin.query(`SELECT r.rolname, r.rolcanlogin FROM pg_namespace n
    JOIN pg_roles r ON n.nspowner=r.oid WHERE n.nspname='source_ingestion'`);
  assert.deepEqual(rows, [{ rolname: 'tv_source_ingestion_owner', rolcanlogin: false }]);
  for (const command of ['SET ROLE tv_source_ingestion_owner', 'CREATE TABLE source_ingestion.forbidden (id int)',
    'UPDATE source_ingestion.deliveries SET provenance=provenance', 'DELETE FROM source_ingestion.deliveries',
    'DELETE FROM source_ingestion.receptions', 'UPDATE source_ingestion.outbox SET payload=payload',
    'DELETE FROM source_ingestion.outbox', 'DELETE FROM tv_migrations.applied'])
    await assert.rejects(pools.runtime.query(command), { code: '42501' });
  const id = await store.appendDelivery(observation(), origin, accepted);
  const event = await pools.runtime.query(`INSERT INTO source_ingestion.outbox
    (delivery_id,stream_revision,event_type,payload) VALUES ($1,1,'source.delivery-accepted.v1',jsonb_build_object('deliveryId',$1::uuid)) RETURNING event_id`, [id]);
  assert.equal((await pools.runtime.query('SELECT FROM event_delivery.deliveries WHERE event_id=$1', [event.rows[0].event_id])).rowCount, 0);
});

test('retention permission migration preserves existing synthetic snapshots and foreign key targets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tv-retention-upgrade-'));
  let database, pool, closePool;
  try {
    for (const name of ['001_durable_correlation.sql', '002_source_deliveries.sql',
      '003_source_acceptance_fingerprint.sql', '004_source_event_delivery_bridge.sql'])
      await copyFile(new URL('../../../../db/migrations/' + name, import.meta.url), join(dir, name));
    database = await createTestDatabase(process.env.TEST_DATABASE_URL, dir);
    pool = new Pool({ connectionString: database.adminUrl, max: 1 });
    closePool = trackPoolShutdown(pool);
    const { fixture, context, scope, origin: fixtureOrigin } = await import('./helpers/provider-fixture.mjs');
    const { normalizeSourceObservation } = await import('../../src/modules/source-connectors/public/index.ts');
    const raw = fixture(), canonical = normalizeSourceObservation(raw, context(raw), scope.capabilities).value;
    const delivery = await postgresSourceDeliveryStore(pool).appendDelivery(canonical.observation, fixtureOrigin, accepted);
    await pool.query('INSERT INTO source_ingestion.synthetic_inputs(delivery_id,canonical) VALUES ($1,$2)', [delivery, canonical]);
    assert.deepEqual(await applyMigrations(pool), ['005_permitted_source_retention.sql', '006_source_replay.sql',
      '007_tracking_position_history.sql', '008_fleet_identity.sql', '009_fleet_identity_replay_progress.sql',
      '010_fleet_identity_position_jobs.sql', '011_fleet_identity_correction_authority.sql',
      '012_fleet_identity_scheduling.sql']);
    const row = (await pool.query('SELECT * FROM source_ingestion.retained_inputs WHERE delivery_id=$1', [delivery])).rows[0];
    assert.deepEqual(row.canonical, canonical);
    assert.equal(row.permission.evidenceReference, 'repository-synthetic-fixtures-only');
    assert.equal(row.permission.provider, 'synthetic');
    const links = await pool.query(`SELECT count(*) AS n FROM pg_constraint WHERE contype='f'
      AND confrelid='source_ingestion.retained_inputs'::regclass`);
    assert.equal(links.rows[0].n, '2');
    await assert.rejects(pool.query('UPDATE source_ingestion.retained_inputs SET permission=$1 WHERE delivery_id=$2',
      [{ ...row.permission, provider: 'different' }, delivery]), { code: '23514' });
    await assert.rejects(pool.query('UPDATE source_ingestion.retained_inputs SET permission=$1 WHERE delivery_id=$2',
      [{}, delivery]), { code: '23514' });
  } finally {
    if (closePool) await closePool();
    if (database) await database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
