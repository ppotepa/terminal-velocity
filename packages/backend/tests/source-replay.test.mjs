import test from 'node:test';
import assert from 'node:assert/strict';
import { replaySourceRange, reviewSourceQuarantine, planSourceRetry, sourceHealth, DEFAULT_REPLAY_POLICY } from '../src/modules/source-connectors/public/index.ts';
import { inspectSourceReplay } from '../src/modules/source-connectors/infrastructure/postgres/source-health-reader.ts';
import { adminOptions, localDatabaseUrl } from '../../../scripts/source/admin-options.mjs';

const request = { sourceId: 'src_synthetic', provider: 'synthetic', account: 'private-fixture', sourceEpoch: 'one', checkpoint: 'window', from: 1000, to: 2000, limit: 10, mode: 'SYNTHETIC' };
const ok = value => ({ ok: true, value });
const bad = code => ({ ok: false, error: { code } });
function fixture() {
  let saved = null, clock = 10000, calls = 0, locked = false;
  const receipts = new Set();
  const store = { async exclusive(scope, work) {
    if (locked) throw new Error('Source replay is already active.');
    locked = true;
    try { return await work({ read: async () => structuredClone(saved), save: async c => { saved = structuredClone(c); } }); }
    finally { locked = false; }
  } };
  const deps = { store, now: () => clock, coverageKind: 'SAMPLED', authorized: async () => true,
    policy: { ...DEFAULT_REPLAY_POLICY, requestTimeoutMs: 1000 },
    reader: { async read() { calls++; return ok({ records: [{ id: 'one', at: 1500 }], bytes: 50, nextCursor: null }); } },
    delivery: { observedAt: raw => Number.isSafeInteger(raw.at) ? ok(raw.at) : { ok: false, error: 'INCOMPLETE_TIME' },
      async accept(raw) { const seen = receipts.has(raw.id); receipts.add(raw.id); return ok(seen ? 'DUPLICATE' : 'CREATED'); } } };
  return { deps, receipts, saved: () => saved, calls: () => calls, time: n => { clock = n; }, run: (r = request) => replaySourceRange(r, deps) };
}

test('delayed 429 schedules Retry-After from response receipt and survives restart', async () => {
  const f = fixture();
  f.deps.reader.read = async () => { f.time(15000); return { ok: false, error: { code: 'RETRY_AFTER', status: 429, retryAfterMs: 4000 } }; };
  const c = await f.run();
  assert.equal(c.nextAttemptAt, 19000);
  assert.equal(c.health.asOf, 15000);
  f.time(18999);
  f.deps.reader.read = async () => assert.fail('Must respect persisted cooldown');
  assert.equal((await f.run()).requests, 1);
});

test('overlap and repeated windows keep durable identities, observation time and source cooldown', async () => {
  const f = fixture();
  f.deps.reader.read = async ({ cursor }) => ok({ records: [{ id: 'one', at: 1500 }], bytes: 50, nextCursor: cursor ? null : 'next' });
  assert.equal((await f.run()).applied, 1);
  f.time(12000);
  let c = await f.run();
  assert.equal(c.duplicate, 1); assert.equal(c.state, 'COMPLETE');
  assert.equal(c.health.lastProviderEventAt, 1500);
  assert.equal(sourceHealth(c, 50000).ingestLag, 48500);
  const next = { ...request, checkpoint: 'next-range' };
  assert.equal((await f.run(next)).requests, 0);
  f.time(14000);
  c = await f.run(next);
  assert.equal(c.duplicate, 1); assert.equal(f.receipts.size, 1);
});

test('empty valid sample is healthy while layout and incomplete time fail parsing independently', async () => {
  const empty = fixture();
  empty.deps.reader.read = async () => ok({ records: [], bytes: 2, nextCursor: null });
  const c = await empty.run();
  assert.equal(c.health.connectionState, 'HEALTHY'); assert.equal(c.health.coverageKind, 'SAMPLED');
  assert.equal(c.health.lastProviderEventAt, null);
  for (const [record, error] of [[{}, 'INCOMPLETE_TIME'], [{ at: 99999 }, 'CLOCK_SKEW'], [{ at: 500 }, 'INCOMPLETE_TIME']]) {
    const f = fixture(); f.deps.reader.read = async () => ok({ records: [record], bytes: 20, nextCursor: null });
    const failed = await f.run();
    assert.equal(failed.health.fetchOutcome, 'OK'); assert.equal(failed.health.parseOutcome, error);
    assert.equal(failed.state, 'QUARANTINED'); assert.equal(f.receipts.size, 0);
  }
  const f = fixture(); f.deps.reader.read = async () => ok({ records: 'changed layout', bytes: 20, nextCursor: null });
  assert.equal((await f.run()).health.parseOutcome, 'MALFORMED_PAYLOAD');
});

test('poison and expired cursor require explicit review; rights and quotas never automatically retry', async () => {
  for (const code of ['MALFORMED_PAYLOAD', 'CURSOR_EXPIRED', 'UNAUTHORIZED', 'QUOTA_EXHAUSTED', 'RIGHTS_REVOKED']) {
    const f = fixture(); f.deps.reader.read = async () => bad(code);
    const c = await f.run(); assert.equal(c.state, 'QUARANTINED');
    f.deps.reader.read = async () => assert.fail('Quarantine must stop acquisition');
    f.time(20000); await f.run();
    await assert.rejects(reviewSourceQuarantine(f.deps.store, request, 'window', 'RETRY_SAME_PAGE', async () => false), /permission/);
    if (code === 'CURSOR_EXPIRED') await assert.rejects(reviewSourceQuarantine(f.deps.store, request, 'window', 'RETRY_SAME_PAGE', async () => true), /restart/);
    await reviewSourceQuarantine(f.deps.store, request, 'window', code === 'CURSOR_EXPIRED' ? 'RESTART_BOUNDED_RANGE' : 'RETRY_SAME_PAGE', async () => true);
    f.deps.reader.read = async () => ok({ records: [{ id: 'one', at: 1500 }], bytes: 50, nextCursor: null });
    assert.equal((await f.run()).state, 'COMPLETE');
  }
});

test('partial outage and lost receipt acknowledgment replay safely without skipping a page', async () => {
  const f = fixture(); const accept = f.deps.delivery.accept;
  f.deps.delivery.accept = async raw => { await accept(raw); throw new Error('secret payload'); };
  const failed = await f.run();
  assert.equal(failed.health.parseOutcome, 'OK'); assert.equal(failed.health.receiptOutcome, 'TRANSIENT_FAILURE');
  assert.equal(failed.cursor, null); assert.equal(failed.state, 'READY');
  f.time(20000); f.deps.delivery.accept = accept;
  const c = await f.run(); assert.equal(c.duplicate, 1); assert.equal(f.receipts.size, 1);
  assert.equal(JSON.stringify(c).includes('secret payload'), false);
});

test('request, byte, record and retry budgets are enforced with no overlapping fetches', async () => {
  for (const page of [{ records: [], bytes: 9999999, nextCursor: null },
    { records: Array(11).fill({ at: 1500 }), bytes: 10, nextCursor: null },
    { records: [{ at: 1500, text: 'x'.repeat(300000) }], bytes: 1, nextCursor: null }]) {
    const f = fixture(); f.deps.reader.read = async () => ok(page);
    assert.equal((await f.run()).state, 'QUARANTINED'); assert.equal(f.receipts.size, 0);
  }
  const f = fixture(); f.deps.policy.maxRequests = 1;
  f.deps.reader.read = async () => bad('TRANSIENT_FAILURE');
  await f.run(); f.time(20000);
  assert.equal((await f.run()).lastError, 'BUDGET_EXHAUSTED');
  await assert.rejects(f.run({ ...request, to: 999999999 }), /bounded/);
  const g = fixture(); let release;
  g.deps.reader.read = () => new Promise(resolve => { release = () => resolve(ok({ records: [], bytes: 2, nextCursor: null })); });
  const running = g.run();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(g.run(), /already active/); release(); await running;
});

test('retry planning respects provider status, maximum delay and maximum attempts', () => {
  for (const failure of [{ code: 'TRANSIENT_FAILURE', status: 400 }, { code: 'RETRY_AFTER', retryAfterMs: 999999 },
    { code: 'RETRY_AFTER', retryAfterMs: -1 }, { code: 'RIGHTS_REVOKED' }])
    assert.deepEqual(planSourceRetry(failure, 1, DEFAULT_REPLAY_POLICY), { kind: 'QUARANTINE' });
  assert.deepEqual(planSourceRetry({ code: 'TRANSIENT_FAILURE', status: 503 }, 2, DEFAULT_REPLAY_POLICY), { kind: 'RETRY', delayMs: 2000 });
  assert.equal(planSourceRetry({ code: 'TRANSIENT_FAILURE' }, 5, DEFAULT_REPLAY_POLICY).kind, 'QUARANTINE');
});

test('admin inspection omits raw scope, cursor and confidential contents and rejects remote or unscoped inputs', async () => {
  const f = fixture(); f.deps.reader.read = async () => ok({ records: [], bytes: 2, nextCursor: 'confidential-cursor' });
  await f.run();
  const output = JSON.stringify(await inspectSourceReplay(f.deps.store, request, 20000));
  for (const secret of ['confidential-cursor', 'private-fixture', 'src_synthetic']) assert.equal(output.includes(secret), false);
  assert.throws(() => adminOptions([], 'inspect'), /scope/);
  for (const url of ['postgres://remote/db', 'postgres://127.0.0.1/db?host=remote', 'https://127.0.0.1/db']) assert.throws(() => localDatabaseUrl(url));
  assert.equal(localDatabaseUrl('postgres://127.0.0.1/db'), 'postgres://127.0.0.1/db');
  assert.throws(() => adminOptions(['--source', 'src_synthetic', '--provider', 'synthetic', '--account', 'private-fixture', '--epoch', 'one', '--cleanup'], 'inspect'));
});

test('late reader response cannot be accepted after the request deadline', async () => {
  const f = fixture(); f.deps.policy.requestTimeoutMs = 1;
  f.deps.reader.read = async ({ signal }) => {
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(signal.aborted, true);
    return ok({ records: [{ id: 'late', at: 1500 }], bytes: 50, nextCursor: null });
  };
  assert.equal((await f.run()).lastError, 'TRANSIENT_FAILURE');
  assert.equal(f.receipts.size, 0);
});

test('rights revocation between receipts disables further ingestion without skipping the failed page', async () => {
  const f = fixture(); let permitted = true;
  f.deps.authorized = async () => permitted;
  f.deps.reader.read = async () => ok({ records: [{ id: 'one', at: 1500 }, { id: 'two', at: 1600 }], bytes: 100, nextCursor: null });
  const accept = f.deps.delivery.accept;
  f.deps.delivery.accept = async raw => { const receipt = await accept(raw); permitted = false; return receipt; };
  const c = await f.run();
  assert.equal(c.health.connectionState, 'DISABLED'); assert.equal(c.lastError, 'RIGHTS_REVOKED');
  assert.equal(c.cursor, null); assert.equal(f.receipts.size, 1);
  assert.equal(c.health.lastProviderEventAt, 1600);
});

test('reader layout drift records successful fetch and failed parse; authorization service outage fails closed', async () => {
  const f = fixture(); f.deps.reader.read = async () => bad('MALFORMED_PAYLOAD');
  const c = await f.run();
  assert.equal(c.health.fetchOutcome, 'OK'); assert.equal(c.health.parseOutcome, 'MALFORMED_PAYLOAD');
  assert.equal(c.health.lastConnectionAt, 10000);
  const g = fixture(); g.deps.authorized = async () => { throw new Error('confidential authorization detail'); };
  const failed = await g.run(); assert.equal(failed.lastError, 'TRANSIENT_FAILURE');
  assert.equal(g.calls(), 0); assert.equal(JSON.stringify(failed).includes('confidential'), false);
});
