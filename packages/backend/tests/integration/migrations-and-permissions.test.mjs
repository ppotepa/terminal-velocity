import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyMigrations } from '../../../../scripts/postgres/migrate.mjs';
import { requireTestDatabaseUrl } from '../../../../scripts/postgres/test-database.mjs';
import { createTestPools, resetTestData, uniqueId } from './helpers/database.mjs';
import { createDecisionEvent, makeDecision, FIXED_TIME } from './helpers/decisions.mjs';

const pools = createTestPools();
beforeEach(() => resetTestData(pools.admin));
after(() => pools.close());

test('schema owners cannot log in and the runtime login cannot own schemas or perform DDL', async () => {
  const expected = new Map([
    ['message_ingestion', 'tv_ingestion_owner'], ['correlation', 'tv_correlation_owner'],
    ['event_delivery', 'tv_delivery_owner'], ['availability', 'tv_availability_owner'],
  ]);
  const owners = await pools.admin.query(`SELECT nspname, pg_get_userbyid(nspowner) AS owner
    FROM pg_namespace WHERE nspname = ANY($1::text[])`, [[...expected.keys()]]);
  assert.deepEqual(new Map(owners.rows.map(row => [row.nspname, row.owner])), expected);
  const roles = await pools.admin.query(`SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
    FROM pg_roles WHERE rolname = ANY($1::text[])`, [[...expected.values(), 'tv_runtime']]);
  assert.equal(roles.rowCount, 5);
  assert.ok(roles.rows.every(row => Object.values(row).every(value => value === false)));
  for (const statement of [
    'CREATE TABLE correlation.forbidden (id integer)',
    'ALTER TABLE availability.contributions ADD COLUMN forbidden integer',
    'SET ROLE tv_correlation_owner',
    'SELECT * FROM tv_migrations.applied',
  ]) await assert.rejects(() => pools.runtime.query(statement), error => error.code === '42501');
});

test('runtime grants preserve immutable message, decision, and event facts while allowing only the outbox marker update', async () => {
  const event = await createDecisionEvent(pools.runtime);
  for (const statement of [
    'UPDATE correlation.aircraft_link_revisions SET directory_revision = directory_revision',
    'DELETE FROM correlation.aircraft_link_revisions',
    'UPDATE correlation.outbox SET payload = payload',
    'DELETE FROM correlation.outbox',
    'UPDATE message_ingestion.messages SET canonical = canonical',
    'DELETE FROM message_ingestion.messages',
    'DELETE FROM availability.contributions',
  ]) await assert.rejects(() => pools.runtime.query(statement), error => error.code === '42501');
  assert.equal((await pools.runtime.query('UPDATE correlation.outbox SET fanout_completed_at = clock_timestamp() WHERE event_id = $1', [event.eventId])).rowCount, 1);
});

test('reused permission roles with an ownership membership are rejected before schema creation', async () => {
  const migration = await readFile(new URL('../../../../db/migrations/001_durable_correlation.sql', import.meta.url), 'utf8');
  const client = await pools.admin.connect();
  try {
    await client.query('BEGIN');
    await client.query('GRANT tv_correlation_owner TO tv_runtime');
    await assert.rejects(() => client.query(migration), /unexpected inherited role membership/);
  } finally { await client.query('ROLLBACK'); client.release(); }
});

test('database constraints reject missing canonical facts, incomplete matches, unsafe integers and partial tombstones', async () => {
  const message = uniqueId('msg');
  for (const canonical of [{}, { messageId: message }, { messageId: uniqueId('msg'), observedAt: FIXED_TIME }])
    await assert.rejects(() => pools.runtime.query('INSERT INTO message_ingestion.messages (message_id, canonical, observed_at_ms, received_at_ms) VALUES ($1, $2, $3, $3)',
      [message, canonical, FIXED_TIME]), error => error.code === '23514');
  const decision = { ...makeDecision(message), status: 'MATCHED', basis: 'EXACT_ACTIVE_IDENTIFIER' };
  await assert.rejects(() => pools.runtime.query(`INSERT INTO correlation.aircraft_link_revisions
    (message_id, revision, decided_at_ms, directory_revision, decision) VALUES ($1, 1, $2, 'test/1', $3)`,
  [message, FIXED_TIME, decision]), error => error.code === '23514');
  await assert.rejects(() => pools.runtime.query('INSERT INTO availability.contributions (message_id, revision) VALUES ($1, $2)',
    [message, '9007199254740992']), error => error.code === '23514');
  await assert.rejects(() => pools.runtime.query('INSERT INTO availability.contributions (message_id, revision, aircraft_id) VALUES ($1, 1, $2)',
    [message, uniqueId('ac')]), error => error.code === '23514');
});

test('migration checksums detect a changed history and a second unmodified run applies nothing', async () => {
  assert.deepEqual(await applyMigrations(pools.admin), []);
  const row = (await pools.admin.query('SELECT name, checksum FROM tv_migrations.applied ORDER BY name LIMIT 1')).rows[0];
  try {
    await pools.admin.query('UPDATE tv_migrations.applied SET checksum = $1 WHERE name = $2', ['0'.repeat(64), row.name]);
    await assert.rejects(() => applyMigrations(pools.admin), /checksum mismatch/);
  } finally {
    await pools.admin.query('UPDATE tv_migrations.applied SET checksum = $1 WHERE name = $2', [row.checksum, row.name]);
  }
});

test('the integration harness refuses remote, ambiguous and overridden database connection URLs', () => {
  for (const url of [undefined, 'postgresql://tv_test_admin:example@db.example.org/tv_test_db',
    'postgresql://tv_test_admin:example@127.0.0.1/production',
    'postgresql://tv_test_admin:example@127.0.0.1/tv_test_db?database=production',
    'postgresql://tv_test_admin:example@127.0.0.1/tv_test_db?host=remote.example.org',
    'postgresql://tv_test_admin:example@127.0.0.1/tv_test_db#fragment'])
    assert.throws(() => requireTestDatabaseUrl(url));
});
