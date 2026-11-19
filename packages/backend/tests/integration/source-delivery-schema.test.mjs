import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { applyMigrations } from '../../../../scripts/postgres/migrate.mjs';
import { createTestDatabase } from '../../../../scripts/postgres/test-database.mjs';
import { parseSourceObservation } from '../../src/modules/source-connectors/public/index.ts';
import { postgresSourceDeliveryStore } from '../../src/modules/source-connectors/infrastructure/postgres/postgres-source-delivery-store.ts';
import { createTestPools, uniqueId } from './helpers/database.mjs';

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
  let database, pool;
  try {
    await copyFile(new URL('../../../../db/migrations/' + first, import.meta.url), join(dir, first));
    database = await createTestDatabase(process.env.TEST_DATABASE_URL, dir);
    pool = new Pool({ connectionString: database.adminUrl, max: 1 });
    const history = () => pool.query('SELECT * FROM tv_migrations.applied WHERE name=$1', [first]);
    const before = (await history()).rows;
    assert.equal(before.length, 1);
    const message = uniqueId('msg');
    await pool.query('INSERT INTO message_ingestion.messages VALUES ($1,$2,1,1)',
      [message, { messageId: message, observedAt: 1 }]);
    assert.deepEqual(await applyMigrations(pool), ['002_source_deliveries.sql', '003_source_acceptance_fingerprint.sql']);
    assert.deepEqual(await applyMigrations(pool), []);
    assert.deepEqual((await history()).rows, before);
    assert.equal((await pool.query('SELECT * FROM message_ingestion.messages WHERE message_id=$1', [message])).rowCount, 1);
  } finally {
    if (pool) await pool.end();
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
