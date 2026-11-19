import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresEventDelivery } from '../../src/modules/event-delivery/infrastructure/postgres-event-delivery.ts';
import { createPostgresDecisionTransaction } from '../../src/modules/aircraft-correlation/infrastructure/postgres/create-postgres-decision-transaction.ts';
import { createTestPools, resetTestData, uniqueId } from './helpers/database.mjs';
import { createDecisionEvent, makeDecision, FIXED_TIME } from './helpers/decisions.mjs';

const pools = createTestPools();
beforeEach(() => resetTestData(pools.admin));
after(() => pools.close());
const consumer = 'integration.availability';
const queue = () => createPostgresEventDelivery(pools.runtime);

async function stage(consumers = [consumer], count = 1) {
  const events = [];
  for (let index = 0; index < count; index++) events.push(await createDecisionEvent(pools.runtime));
  assert.equal(await queue().fanOut(consumers, 100), count);
  return events;
}
async function countEffect(sql, event) {
  await sql.query(`INSERT INTO availability.contributions (message_id, revision) VALUES ($1, 1)
    ON CONFLICT (message_id) DO UPDATE SET revision = availability.contributions.revision + 1`,
  [event.payload.decision.messageId]);
}
async function effectCount(messageId) {
  const result = await pools.runtime.query('SELECT revision::integer FROM availability.contributions WHERE message_id = $1', [messageId]);
  return result.rows[0]?.revision ?? 0;
}
async function expire(lease) {
  await pools.admin.query("UPDATE event_delivery.deliveries SET lease_until = clock_timestamp() - interval '1 millisecond' WHERE consumer_id = $1 AND event_id = $2", [lease.consumerId, lease.eventId]);
}
async function delivery(eventId, consumerId = consumer) {
  return (await pools.admin.query('SELECT * FROM event_delivery.deliveries WHERE consumer_id = $1 AND event_id = $2', [consumerId, eventId])).rows[0];
}

test('fan-out includes an earlier allocated event that commits after a later event was dispatched', async () => {
  let announce, release;
  const staged = new Promise(resolve => { announce = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const decision = makeDecision();
  const earlyId = 'evt_earlier';
  const pending = createPostgresDecisionTransaction(pools.runtime).run(async writes => {
    await writes.read(decision.messageId);
    const payload = { decision, revision: 1, decidedAt: FIXED_TIME, directoryRevision: 'integration/1' };
    await writes.put(payload);
    await writes.appendOutbox({ eventId: earlyId, type: 'correlation.aircraft-decision-revised.v1', payload });
    announce();
    await gate;
  });
  try {
    await staged;
    const later = await createDecisionEvent(pools.runtime, { eventId: 'evt_later' });
    assert.equal(await queue().fanOut([consumer], 10), 1);
    assert.ok(await delivery(later.eventId));
    assert.equal(await delivery(earlyId), undefined);
  } finally { release(); await pending; }
  assert.equal(await queue().fanOut([consumer], 10), 1);
  assert.ok(await delivery(earlyId));
  assert.equal(await queue().fanOut([consumer], 10), 0);
});

test('queue claims skip a locked row and competing workers never receive the same delivery', async () => {
  const events = await stage([consumer], 3);
  const blocker = await pools.admin.connect();
  let first;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT 1 FROM event_delivery.deliveries WHERE event_id = $1 FOR UPDATE', [events[0].eventId]);
    first = await queue().leaseNext(consumer, 10_000);
    assert.notEqual(first.eventId, events[0].eventId);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  const remaining = await Promise.all([queue().leaseNext(consumer, 10_000), queue().leaseNext(consumer, 10_000)]);
  assert.equal(new Set([first, ...remaining].map(lease => lease.eventId)).size, 3);
  assert.equal(new Set([first, ...remaining].map(lease => lease.token)).size, 3);
  assert.equal(await queue().leaseNext(consumer, 10_000), null);
});

test('an abandoned lease is recovered and its old token cannot consume, retry, or quarantine new work', async () => {
  const [event] = await stage();
  const first = await queue().leaseNext(consumer, 10_000);
  await expire(first);
  assert.equal(await queue().recoverExpired(10), 1);
  const second = await queue().leaseNext(consumer, 10_000);
  assert.notEqual(second.token, first.token);
  assert.equal(second.attempt, 2);
  assert.equal(await queue().consume(first, countEffect), 'STALE_LEASE');
  assert.equal(await queue().retry(first, { code: 'TRANSIENT_FAILURE', delayMs: 0 }), 'STALE_LEASE');
  assert.equal(await queue().quarantine(first, 'INVALID_EVENT'), 'STALE_LEASE');
  assert.equal(await effectCount(event.payload.decision.messageId), 0);
  assert.equal(await queue().consume(second, countEffect), 'APPLIED');
  assert.equal(await effectCount(event.payload.decision.messageId), 1);
});

test('two concurrent consumers of the same lease commit one inbox entry and one effect', async () => {
  const [event] = await stage();
  const lease = await queue().leaseNext(consumer, 10_000);
  const outcomes = await Promise.all([queue().consume(lease, countEffect), queue().consume(lease, countEffect)]);
  assert.deepEqual(outcomes.sort(), ['APPLIED', 'STALE_LEASE']);
  assert.equal(await effectCount(event.payload.decision.messageId), 1);
  assert.equal((await pools.admin.query('SELECT count(*)::integer AS count FROM event_delivery.consumer_inbox')).rows[0].count, 1);
  assert.equal((await delivery(event.eventId)).state, 'DONE');
});

test('redelivery after a committed inbox entry skips the effect and a lost reply cannot repeat completion', async () => {
  const [event] = await stage();
  const first = await queue().leaseNext(consumer, 10_000);
  assert.equal(await queue().consume(first, countEffect), 'APPLIED');
  assert.equal(await queue().consume(first, countEffect), 'STALE_LEASE');
  // Simulate a transport redelivery while preserving the committed consumer inbox.
  await pools.admin.query("UPDATE event_delivery.deliveries SET state = 'READY', completed_at = NULL WHERE event_id = $1", [event.eventId]);
  const replay = await queue().leaseNext(consumer, 10_000);
  assert.equal(await queue().consume(replay, countEffect), 'DUPLICATE');
  assert.equal(await effectCount(event.payload.decision.messageId), 1);
});

test('different consumer IDs each apply the same event once', async () => {
  const consumers = ['integration.first', 'integration.second'];
  const [event] = await stage(consumers);
  for (const id of consumers) {
    const lease = await queue().leaseNext(id, 10_000);
    assert.equal(await queue().consume(lease, countEffect), 'APPLIED');
  }
  assert.equal(await effectCount(event.payload.decision.messageId), 2);
  assert.equal((await pools.admin.query('SELECT count(*)::integer AS count FROM event_delivery.consumer_inbox')).rows[0].count, 2);
});

test('a failed projector rolls back its effects and inbox entry and a retry can apply the event', async () => {
  const [event] = await stage();
  const lease = await queue().leaseNext(consumer, 10_000);
  await assert.rejects(() => queue().consume(lease, async (sql, input) => {
    await countEffect(sql, input);
    await sql.query('SELECT 1 / 0');
  }), error => error.code === '22012');
  assert.equal(await effectCount(event.payload.decision.messageId), 0);
  assert.equal((await pools.admin.query('SELECT count(*)::integer AS count FROM event_delivery.consumer_inbox')).rows[0].count, 0);
  assert.equal((await delivery(event.eventId)).state, 'LEASED');
  assert.equal(await queue().retry(lease, { code: 'PROJECTOR_FAILED', delayMs: 0 }), 'RETRY_SCHEDULED');
  const next = await queue().leaseNext(consumer, 10_000);
  assert.equal(await queue().consume(next, countEffect), 'APPLIED');
});

test('lease expiry during projection rolls back the pending inbox, effect, and completion', async () => {
  const [event] = await stage();
  const lease = await queue().leaseNext(consumer, 1_000);
  let projected = false;
  const outcome = await queue().consume(lease, async (sql, input) => {
    projected = true;
    await countEffect(sql, input);
    await sql.query('SELECT pg_sleep(1.05)');
  });
  assert.equal(projected, true);
  assert.equal(outcome, 'STALE_LEASE');
  assert.equal(await effectCount(event.payload.decision.messageId), 0);
  assert.equal((await pools.admin.query('SELECT count(*)::integer AS count FROM event_delivery.consumer_inbox')).rows[0].count, 0);
  assert.equal((await delivery(event.eventId)).state, 'LEASED');
});

test('a conflicting inbox digest prevents projection and can be explicitly quarantined', async () => {
  const [event] = await stage();
  await pools.admin.query('INSERT INTO event_delivery.consumer_inbox (consumer_id, event_id, payload_digest) VALUES ($1, $2, $3)',
    [consumer, event.eventId, '0'.repeat(64)]);
  const lease = await queue().leaseNext(consumer, 10_000);
  await assert.rejects(() => queue().consume(lease, countEffect), error => error.code === 'EVENT_ID_CONFLICT');
  assert.equal(await effectCount(event.payload.decision.messageId), 0);
  assert.equal(await queue().quarantine(lease, 'EVENT_ID_CONFLICT'), 'QUARANTINED');
  assert.equal((await delivery(event.eventId)).state, 'QUARANTINED');
});

test('retry backoff and the maximum attempt count prevent an unbounded retry loop', async () => {
  const [event] = await stage();
  const limited = createPostgresEventDelivery(pools.runtime, { maxAttempts: 2 });
  const first = await limited.leaseNext(consumer, 10_000);
  assert.equal(await limited.retry(first, { code: 'RETRYABLE_FAILURE', delayMs: 60_000 }), 'RETRY_SCHEDULED');
  assert.equal(await limited.leaseNext(consumer, 10_000), null);
  await pools.admin.query("UPDATE event_delivery.deliveries SET next_attempt_at = clock_timestamp() - interval '1 millisecond' WHERE event_id = $1", [event.eventId]);
  const second = await limited.leaseNext(consumer, 10_000);
  assert.equal(second.attempt, 2);
  assert.equal(await limited.retry(second, { code: 'RETRYABLE_FAILURE', delayMs: 0 }), 'QUARANTINED');
  assert.equal(await limited.leaseNext(consumer, 10_000), null);
});

test('a lower retry budget after restart quarantines already exhausted READY deliveries', async () => {
  const [event] = await stage();
  await pools.admin.query('UPDATE event_delivery.deliveries SET attempts = 2 WHERE event_id = $1', [event.eventId]);
  const limited = createPostgresEventDelivery(pools.runtime, { maxAttempts: 2 });
  assert.equal(await limited.leaseNext(consumer, 10_000), null);
  assert.equal((await delivery(event.eventId)).state, 'QUARANTINED');
  assert.equal((await delivery(event.eventId)).last_failure_code, 'RETRY_BUDGET_EXHAUSTED');
});

test('mutating a caller-owned lease after consume starts cannot redirect its inbox or acknowledgement', async () => {
  const [event] = await stage();
  const lease = { ...await queue().leaseNext(consumer, 10_000) };
  const consume = queue().consume(lease, countEffect);
  lease.consumerId = 'integration.changed'; lease.eventId = uniqueId('evt');
  lease.token = '00000000-0000-0000-0000-000000000000';
  assert.equal(await consume, 'APPLIED');
  assert.equal((await delivery(event.eventId)).state, 'DONE');
  assert.equal(await effectCount(event.payload.decision.messageId), 1);
});
