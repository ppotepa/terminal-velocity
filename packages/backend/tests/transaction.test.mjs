import test from 'node:test';
import assert from 'node:assert/strict';
import { createCorrelateMessage } from '../src/modules/aircraft-correlation/public/index.ts';
import { candidate, icao, A } from './fixtures.mjs';
import { createDemo } from '../src/app/create-demo.ts';

test('commit persists the decision and outbox atomically', async () => {
  const demo = createDemo();
  const outcome = await demo.correlate(demo.input, null);
  assert.equal(outcome.ok, true);
  assert.equal(demo.memory.inspect().records.size, 1);
  assert.equal(demo.memory.inspect().outbox.length, 1);
});

test('outbox failure rolls back the decision; retry can complete the entire write', async () => {
  const demo = createDemo(); demo.memory.failNextOutboxAppend();
  const failure = await demo.correlate(demo.input, null);
  assert.deepEqual(failure, { ok: false, error: { code: 'COMMIT_FAILED' } });
  assert.equal(demo.memory.inspect().records.size, 0);
  assert.equal(demo.memory.inspect().outbox.length, 0);
  assert.equal((await demo.correlate(demo.input, null)).ok, true);
  assert.equal(demo.memory.inspect().outbox.length, 1);
});

test('expectedRevision rejects a stale write without producing an event', async () => {
  const demo = createDemo();
  const first = await demo.correlate(demo.input, null);
  const stale = await demo.correlate(demo.input, null);
  assert.equal(stale.ok, false); assert.equal(stale.error.code, 'STALE_REVISION');
  assert.equal(demo.memory.inspect().outbox.length, 1);
  assert.equal((await demo.correlate(demo.input, first.value.revision)).value.revision, 2);
});

test('two concurrent writes from the same revision produce exactly one commit', async () => {
  const demo = createDemo();
  const attempts = await Promise.all([demo.correlate(demo.input, null), demo.correlate(demo.input, null)]);
  assert.equal(attempts.filter(result => result.ok).length, 1);
  assert.equal(demo.memory.inspect().outbox.length, 1);
});

test('the transaction capability expires when the callback finishes', async () => {
  const demo = createDemo(); let leaked;
  await demo.memory.transaction.run(async writes => { leaked = writes; });
  await assert.rejects(() => leaked.read(demo.message), /expired/);
});


for (const candidates of [[], [candidate(A, [icao('48C2B4')])]]) {
  test(`an incomplete set of ${candidates.length} candidates commits neither MATCHED nor UNMATCHED`, async () => {
    const demo = createDemo();
    const correlate = createCorrelateMessage({
      directory: { async find() { return { completeness:'PARTIAL', reason:'LIMIT_REACHED', revision:'directory/7', candidates }; } },
      clock: { now: () => demo.at }, transaction: demo.memory.transaction,
      eventIds: { next: () => { throw new Error('Must not allocate event for incomplete candidates'); } },
    });
    const outcome = await correlate(demo.input,null);
    assert.deepEqual(outcome,{ok:false,error:{code:'CANDIDATE_SET_INCOMPLETE',reason:'LIMIT_REACHED'}});
    assert.equal(demo.memory.inspect().records.size,0);
    assert.equal(demo.memory.inspect().outbox.length,0);
  });
}
