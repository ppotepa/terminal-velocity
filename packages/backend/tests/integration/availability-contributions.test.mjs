import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runSqlTransaction } from '../../src/modules/database-transactions/public/index.ts';
import { createPostgresContributionWriter } from '../../src/modules/message-availability/infrastructure/postgres-contribution-writer.ts';
import { createPostgresAvailabilityReader } from '../../src/modules/message-availability/infrastructure/postgres-availability-reader.ts';
import { createPostgresEventDelivery } from '../../src/modules/event-delivery/infrastructure/postgres-event-delivery.ts';
import { createTestPools, resetTestData, uniqueId } from './helpers/database.mjs';
import { createDecisionEvent, FIXED_TIME } from './helpers/decisions.mjs';

const pools = createTestPools();
beforeEach(() => resetTestData(pools.admin));
after(() => pools.close());
const read = () => createPostgresAvailabilityReader(pools.runtime).lastMessageTimes();
const apply = change => runSqlTransaction(pools.runtime, sql => createPostgresContributionWriter(sql).apply(change));
function assigned(messageId, aircraftId, observedAt = FIXED_TIME, revision = 1, publicEligible = true) {
  return { type: 'ASSIGNED', revision,
    contribution: { messageId, aircraftId, observedAt, bearer: 'VDL2', publicEligible } };
}

test('contribution duplicates and older revisions are ignored; equal revisions with changed facts are rejected', async () => {
  const message = uniqueId('msg'), aircraft = uniqueId('ac');
  const input = assigned(message, aircraft, FIXED_TIME, 3);
  assert.equal(await apply(input), 'APPLIED');
  assert.equal(await apply(structuredClone(input)), 'IGNORED');
  assert.equal(await apply(assigned(message, uniqueId('ac'), FIXED_TIME + 10, 2)), 'IGNORED');
  await assert.rejects(() => apply(assigned(message, aircraft, FIXED_TIME + 1, 3)),
    error => error.code === 'REVISION_COLLISION');
  assert.deepEqual(await read(), new Map([[aircraft, FIXED_TIME]]));
});

test('competing first contributions with the same revision cannot silently overwrite each other', async () => {
  const message = uniqueId('msg');
  const attempts = await Promise.allSettled([
    apply(assigned(message, uniqueId('ac'))), apply(assigned(message, uniqueId('ac'))),
  ]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled' && result.value === 'APPLIED').length, 1);
  assert.equal(attempts.find(result => result.status === 'rejected').reason.code, 'REVISION_COLLISION');
  assert.equal((await read()).size, 1);
});

test('moving the latest contribution to another aircraft exposes the old aircraft previous message', async () => {
  const first = uniqueId('ac'), second = uniqueId('ac');
  const moved = uniqueId('msg');
  await apply(assigned(uniqueId('msg'), first, FIXED_TIME - 100));
  await apply(assigned(moved, first, FIXED_TIME));
  await apply(assigned(moved, second, FIXED_TIME, 2));
  assert.deepEqual(await read(), new Map([[first, FIXED_TIME - 100], [second, FIXED_TIME]]));
  await apply({ type: 'RETRACTED', revision: 3, messageId: moved });
  assert.deepEqual(await read(), new Map([[first, FIXED_TIME - 100]]));
});

test('a hidden contribution stores a tombstone and an older delivery cannot resurrect public state', async () => {
  const message = uniqueId('msg'), aircraft = uniqueId('ac');
  await apply(assigned(message, aircraft));
  assert.equal(await apply(assigned(message, aircraft, FIXED_TIME, 4, false)), 'APPLIED');
  assert.equal(await apply(assigned(message, aircraft, FIXED_TIME, 3)), 'IGNORED');
  assert.equal(await apply({ type: 'RETRACTED', revision: 4, messageId: message }), 'IGNORED');
  assert.equal((await read()).size, 0);
  const stored = (await pools.runtime.query('SELECT revision::integer, aircraft_id, observed_at_ms, bearer FROM availability.contributions WHERE message_id = $1', [message])).rows[0];
  assert.deepEqual(stored, { revision: 4, aircraft_id: null, observed_at_ms: null, bearer: null });
});

test('late backfill preserves its original observation time and cannot advance the latest message', async () => {
  const aircraft = uniqueId('ac');
  await apply(assigned(uniqueId('msg'), aircraft, FIXED_TIME));
  await apply(assigned(uniqueId('msg'), aircraft, FIXED_TIME - 3_600_000));
  assert.equal((await read()).get(aircraft), FIXED_TIME);
});

test('mutating input while its SQL operation is awaiting cannot change the stored contribution', async () => {
  const message = uniqueId('msg'), aircraft = uniqueId('ac');
  const input = assigned(message, aircraft);
  let signal, release;
  const reachedQuery = new Promise(resolve => { signal = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const pending = runSqlTransaction(pools.runtime, sql => createPostgresContributionWriter({
    async query(text, values) { signal(); await gate; return sql.query(text, values); },
  }).apply(input));
  await reachedQuery;
  input.revision = 99; input.contribution.aircraftId = uniqueId('ac');
  input.contribution.observedAt = FIXED_TIME + 9_000; input.contribution.publicEligible = false;
  release();
  assert.equal(await pending, 'APPLIED');
  assert.deepEqual(await read(), new Map([[aircraft, FIXED_TIME]]));
  assert.equal((await pools.runtime.query('SELECT revision::integer FROM availability.contributions WHERE message_id = $1', [message])).rows[0].revision, 1);
});

test('a contribution revision collision rolls back the consumer inbox and preserves the prior projection', async () => {
  const message = uniqueId('msg'), oldAircraft = uniqueId('ac'), newAircraft = uniqueId('ac');
  await apply(assigned(message, oldAircraft));
  const event = await createDecisionEvent(pools.runtime, { messageId: message, aircraftId: newAircraft });
  const delivery = createPostgresEventDelivery(pools.runtime);
  await delivery.fanOut(['availability.integration'], 10);
  const lease = await delivery.leaseNext('availability.integration', 10_000);
  await assert.rejects(() => delivery.consume(lease, sql =>
    createPostgresContributionWriter(sql).apply(assigned(message, newAircraft))),
  error => error.code === 'REVISION_COLLISION');
  assert.deepEqual(await read(), new Map([[oldAircraft, FIXED_TIME]]));
  assert.equal((await pools.runtime.query('SELECT 1 FROM event_delivery.consumer_inbox WHERE event_id = $1', [event.eventId])).rowCount, 0);
});
