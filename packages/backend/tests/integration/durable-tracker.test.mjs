import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresDemoTracker } from '../../src/demo/public/index.ts';
import { createIngestDurableMessage } from '../../src/demo/application/ingest-durable-message.ts';
import { parseMessageInput } from '../../src/demo/application/parse-message-input.ts';
import { createPostgresIngestTransaction } from '../../src/demo/infrastructure/postgres/postgres-ingest-transaction.ts';
import { createFixtureFleet } from '../../src/demo/infrastructure/fixture-fleet.ts';
import { createFixtureCandidateDirectory } from '../../src/demo/infrastructure/fixture-candidate-directory.ts';
import { createPostgresDecisionWriteSet } from '../../src/modules/aircraft-correlation/infrastructure/postgres/create-postgres-decision-write-set.ts';
import { createPostgresDecisionTransaction } from '../../src/modules/aircraft-correlation/infrastructure/postgres/create-postgres-decision-transaction.ts';
import { runDecisionWork } from '../../src/modules/aircraft-correlation/infrastructure/postgres/run-decision-work.ts';
import { commitDecision, decideAircraftMatch } from '../../src/modules/aircraft-correlation/public/index.ts';
import { createTestPools, resetTestData, uniqueId } from './helpers/database.mjs';

let pools;
before(() => { pools = createTestPools(); });
beforeEach(() => resetTestData(pools.admin));
after(() => pools.close());

function input(overrides = {}) {
  return { messageId: uniqueId('msg'), observedAt: new Date(Date.now() - 1_000).toISOString(),
    bearer: 'VDL2', text: 'Synthetic durable integration message', icao24: 'D00001', ...overrides };
}
async function runtime(t) {
  const value = await createPostgresDemoTracker({ connectionString: process.env.TEST_RUNTIME_DATABASE_URL, startWorker: false });
  t.after(() => value.close());
  return value;
}
function correctedDecision(message, aircraftId) {
  const identifier = { kind: 'ICAO24', value: 'D00001' };
  return decideAircraftMatch({ messageId: message.messageId, effectiveAt: Date.parse(message.observedAt), identifiers: [identifier], callsign: null },
    aircraftId ? [{ aircraftId, aliases: [{ identifier, validFrom: 0, validUntil: null }] }] : []);
}

test('durable facts and pending outbox work survive closing and recreating the tracker', async t => {
  const first = await runtime(t), message = input();
  const created = await first.tracker.ingest(message);
  assert.equal(created.ok, true);
  assert.equal(created.value.created, true);
  assert.equal((await first.tracker.getAircraft('ac_demo-001')).value.availability.freshness, 'NONE');
  await first.close();
  const restored = await runtime(t);
  assert.equal(await restored.checkHealth(), true);
  assert.deepEqual((await restored.tracker.getMessage(message.messageId)).value, created.value.message);
  assert.equal((await restored.tracker.ingest(message)).value.created, false);
  assert.equal(await restored.drain(), 1);
  const aircraft = (await restored.tracker.getAircraft('ac_demo-001')).value;
  assert.equal(aircraft.availability.freshness, 'RECENT');
  assert.equal(aircraft.availability.lastMessageAt, message.observedAt);
  assert.equal(await restored.drain(), 0);
});

test('independent tracker pools serialize duplicate and conflicting first ingestions', async t => {
  const left = await runtime(t), right = await runtime(t), message = input();
  const receipts = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? left : right).tracker.ingest(message)));
  assert.ok(receipts.every(value => value.ok));
  assert.equal(receipts.filter(value => value.value.created).length, 1);
  const conflictMessage = input();
  const conflicting = await Promise.all([
    left.tracker.ingest(conflictMessage), right.tracker.ingest({ ...conflictMessage, text: 'Different canonical facts' }),
  ]);
  assert.equal(conflicting.filter(value => value.ok && value.value.created).length, 1);
  assert.equal(conflicting.filter(value => !value.ok && value.error.code === 'MESSAGE_CONFLICT').length, 1);
  const result = await pools.admin.query(`SELECT
    (SELECT count(*)::int FROM message_ingestion.messages) AS messages,
    (SELECT count(*)::int FROM correlation.aircraft_link_revisions) AS decisions,
    (SELECT count(*)::int FROM correlation.outbox) AS events`);
  assert.deepEqual(result.rows[0], { messages: 2, decisions: 2, events: 2 });
});

test('outbox failure rolls back canonical facts as well as decision history and permits a later retry', async () => {
  const transaction = createPostgresIngestTransaction(pools.runtime, sql => {
    const writes = createPostgresDecisionWriteSet(sql);
    return { read: writes.read, run: work => runDecisionWork(writes, work) };
  });
  const directory = createFixtureCandidateDirectory(createFixtureFleet());
  const event = uniqueId('evt');
  const ingest = createIngestDurableMessage(transaction, directory, { next: () => event }, Date.now);
  const first = input(), second = input();
  assert.equal((await ingest(parseMessageInput(first).value)).ok, true);
  await assert.rejects(ingest(parseMessageInput(second).value), /could not be committed/);
  const result = await pools.admin.query(`SELECT
    (SELECT count(*)::int FROM message_ingestion.messages WHERE message_id = $1) AS messages,
    (SELECT count(*)::int FROM correlation.aircraft_link_revisions WHERE message_id = $1) AS decisions,
    (SELECT count(*)::int FROM correlation.outbox WHERE stream_key = $1) AS events`, [second.messageId]);
  assert.deepEqual(result.rows[0], { messages: 0, decisions: 0, events: 0 });
  const retry = createIngestDurableMessage(transaction, directory, { next: () => uniqueId('evt') }, Date.now);
  assert.equal((await retry(parseMessageInput(second).value)).value.created, true);
});

test('durable decision corrections move availability and preserve the older observed-time fallback', async t => {
  const store = await runtime(t);
  const historical = input({ observedAt: new Date(Date.now() - 20 * 60_000).toISOString() });
  const recent = input();
  assert.equal((await store.tracker.ingest(historical)).ok, true);
  assert.equal((await store.tracker.ingest(recent)).ok, true);
  await store.drain();
  const transaction = createPostgresDecisionTransaction(pools.runtime);
  const ids = { next: () => uniqueId('evt') };
  const moved = await commitDecision(correctedDecision(recent, 'ac_demo-002'), 1, 'synthetic-catalog-correction/2', Date.now(), transaction, ids);
  assert.equal(moved.ok, true);
  await store.drain();
  const previous = (await store.tracker.getAircraft('ac_demo-001')).value;
  const next = (await store.tracker.getAircraft('ac_demo-002')).value;
  assert.equal(previous.availability.lastMessageAt, historical.observedAt);
  assert.equal(previous.availability.freshness, 'STALE');
  assert.equal(next.availability.lastMessageAt, recent.observedAt);
  assert.equal(next.availability.freshness, 'RECENT');
  assert.equal((await store.tracker.getMessages('ac_demo-001')).value.length, 1);
  assert.equal((await store.tracker.getMessages('ac_demo-002')).value.length, 1);
  const retracted = await commitDecision(correctedDecision(recent, null), 2, 'synthetic-catalog-correction/3', Date.now(), transaction, ids);
  assert.equal(retracted.ok, true);
  await store.drain();
  assert.equal((await store.tracker.getAircraft('ac_demo-002')).value.availability.freshness, 'NONE');
  const tombstone = await pools.admin.query('SELECT revision::text, aircraft_id FROM availability.contributions WHERE message_id = $1', [recent.messageId]);
  assert.deepEqual(tombstone.rows[0], { revision: '3', aircraft_id: null });
});
