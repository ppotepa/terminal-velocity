import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { replaySourceRange, reviewSourceQuarantine, DEFAULT_REPLAY_POLICY } from '../../src/modules/source-connectors/public/index.ts';
import { postgresSourceReplayStore } from '../../src/modules/source-connectors/infrastructure/postgres/source-replay-store.ts';
import { inspectSourceReplay } from '../../src/modules/source-connectors/infrastructure/postgres/source-health-reader.ts';
import { syntheticReplay } from '../../../../scripts/source/synthetic-replay.mjs';
import { createTestPools, uniqueId, resetTestData } from './helpers/database.mjs';
import { spawn } from 'node:child_process';

const pools = createTestPools();
beforeEach(() => resetTestData(pools.admin));
after(() => pools.close());
const request = () => ({ sourceId: 'src_synthetic', provider: 'synthetic', account: 'private-fixture',
  sourceEpoch: uniqueId('replay'), checkpoint: 'window', from: 1000, to: 2000, limit: 10, mode: 'SYNTHETIC' });

function setup(r, pool = pools.runtime) {
  let clock = 10000;
  return { deps: { ...syntheticReplay(pool, r, () => clock), store: postgresSourceReplayStore(pool) }, time: n => { clock = n; } };
}
async function effects(r) {
  return (await pools.runtime.query(`SELECT d.observed_at_ms, d.retention, count(o.event_id)::int AS events
    FROM source_ingestion.deliveries d JOIN source_ingestion.outbox o USING(delivery_id)
    WHERE d.source_epoch=$1 GROUP BY d.delivery_id`, [r.sourceEpoch])).rows;
}

test('normal synthetic replay composition survives pool restart, overlaps once and imports retained inputs into private availability', async () => {
  const r = request(), f = setup(r);
  const first = await replaySourceRange(r, f.deps);
  assert.equal(first.applied, 1); assert.equal(first.cursor, 'synthetic-overlap');
  const other = createTestPools();
  try {
    const restart = setup(r, other.runtime); restart.time(30000);
    const final = await replaySourceRange(r, restart.deps);
    assert.equal(final.state, 'COMPLETE'); assert.equal(final.applied, 1); assert.equal(final.duplicate, 1);
    assert.equal(final.health.lastProviderEventAt, 1000);
    await restart.deps.pipeline.drain();
    await assertDownstream(r, restart.deps.pipeline);
    assert.deepEqual(await effects(r), [{ observed_at_ms: '1000', retention: 'METADATA_ONLY', events: 1 }]);
    const report = JSON.stringify(await inspectSourceReplay(restart.deps.store, r, 40000));
    assert.equal(report.includes('Synthetic replay fixture'), false);
    assert.equal(report.includes('synthetic-overlap'), false);
    assert.equal(report.includes(r.sourceEpoch), false);
  } finally { await other.close(); }
});

test('receipt committed before crash is recovered through duplicate acceptance with no cursor advancement', async () => {
  const r = request(), f = setup(r), store = f.deps.store;
  f.deps.store = { exclusive: (scope, work) => store.exclusive(scope, session => work({ ...session,
    async save(c) { if (c.cursor !== null) throw new Error('Simulated crash before checkpoint commit'); await session.save(c); },
  })) };
  await assert.rejects(replaySourceRange(r, f.deps), /Simulated crash/);
  const reserved = await store.exclusive(r, s => s.read());
  assert.equal(reserved.cursor, null); assert.equal(reserved.requests, 1);
  assert.equal((await effects(r)).length, 1);
  f.deps.store = store; f.time(30000);
  const recovered = await replaySourceRange(r, f.deps);
  assert.equal(recovered.duplicate, 1); assert.equal((await effects(r))[0].events, 1);
  await f.deps.pipeline.drain(); await assertDownstream(r, f.deps.pipeline);
});

test('source lock excludes concurrent ranges and is released after a failed operation', async () => {
  const r = request(), store = postgresSourceReplayStore(pools.runtime);
  const other = createTestPools();
  try {
    await store.exclusive(r, async () => {
      await assert.rejects(postgresSourceReplayStore(other.runtime).exclusive(r, async () => {}), /already active/);
    });
    await assert.rejects(store.exclusive(r, async () => { throw new Error('fixture interruption'); }), /interruption/);
    assert.equal(await postgresSourceReplayStore(other.runtime).exclusive(r, async () => 'acquired'), 'acquired');
  } finally { await other.close(); }
});

test('quarantine and delayed retry metadata survive independent connections and require exact review', async () => {
  const r = request(), f = setup(r);
  f.deps.reader.read = async () => { f.time(15000); return { ok: false, error: { code: 'RETRY_AFTER', status: 429, retryAfterMs: 14000 } }; };
  const retry = await replaySourceRange(r, f.deps); assert.equal(retry.nextAttemptAt, 29000);
  const other = createTestPools();
  try {
    const g = setup(r, other.runtime); g.time(30000);
    g.deps.reader.read = async () => ({ ok: false, error: { code: 'CURSOR_EXPIRED' } });
    assert.equal((await replaySourceRange(r, g.deps)).state, 'QUARANTINED');
    await assert.rejects(reviewSourceQuarantine(g.deps.store, r, 'wrong', 'RESTART_BOUNDED_RANGE', async () => true), /exact/);
    await assert.rejects(reviewSourceQuarantine(g.deps.store, r, 'window', 'RETRY_SAME_PAGE', async () => true), /restart/);
    await reviewSourceQuarantine(g.deps.store, r, 'window', 'RESTART_BOUNDED_RANGE', g.deps.authorized);
    g.deps.reader = syntheticReplay(other.runtime, r, () => 50000).reader; g.time(50000);
    assert.equal((await replaySourceRange(r, g.deps)).applied, 1);
  } finally { await other.close(); }
});

test('runtime cannot delete checkpoints and failed updates leave previous checkpoint intact', async () => {
  const r = request(), f = setup(r); await replaySourceRange(r, f.deps);
  await assert.rejects(pools.runtime.query('DELETE FROM source_ingestion.replay_checkpoints'), { code: '42501' });
  await f.deps.store.exclusive(r, async session => {
    const c = await session.read();
    await assert.rejects(session.save({ ...c, processed: 501 }), { code: '23514' });
    assert.equal((await session.read()).processed, 1);
    await assert.rejects(session.save({ ...c, request: { ...r, account: 'other' } }), /scope mismatch/);
  });
});

function cli(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`scripts/source/${script}.mjs`, ...args], {
      env: { ...process.env, DATABASE_URL: process.env.TEST_RUNTIME_DATABASE_URL }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { err += data; });
    child.on('error', reject); child.on('close', code => resolve({ code, out, err }));
  });
}
test('local operator commands exercise real receipt composition and reject unsafe inputs without exposing secrets', async () => {
  const r = request();
  const scope = ['--source', r.sourceId, '--provider', r.provider, '--account', r.account, '--epoch', r.sourceEpoch];
  const run = await cli('replay', [...scope, '--fixture', '--checkpoint', 'window', '--from', '1000', '--to', '2000', '--limit', '10']);
  assert.equal(run.code, 0, run.err); assert.equal(JSON.parse(run.out).applied, 1);
  const pipeline = syntheticReplay(pools.runtime, r).pipeline;
  await assertDownstream(r, pipeline);
  // Restart the real command after its persisted source cooldown, then overlap.
  const checkpoint = await postgresSourceReplayStore(pools.runtime).exclusive(r, s => s.read());
  await new Promise(resolve => setTimeout(resolve, Math.max(0, checkpoint.nextAttemptAt - Date.now())));
  const overlap = await cli('replay', [...scope, '--fixture', '--checkpoint', 'window', '--from', '1000', '--to', '2000', '--limit', '10']);
  assert.equal(overlap.code, 0, overlap.err);
  assert.equal(JSON.parse(overlap.out).duplicate, 1);
  assert.equal(JSON.parse(overlap.out).state, 'COMPLETE');
  await assertDownstream(r, pipeline);
  const inspect = await cli('inspect-quarantine', scope);
  assert.equal(inspect.code, 0, inspect.err); assert.equal(JSON.parse(inspect.out).cursorPresent, false);
  assert.equal(inspect.out.includes(r.sourceEpoch), false);
  const rejected = await cli('replay', [...scope, '--delete-all']);
  assert.equal(rejected.code, 1); assert.match(rejected.err, /SOURCE_REPLAY_FAILED/);
  assert.equal(rejected.err.includes(process.env.TEST_RUNTIME_DATABASE_URL), false);
});

test('poison observation is durably quarantined before any receipt and corrected fixture can resume', async () => {
  const r = request(), f = setup(r), validReader = f.deps.reader;
  f.deps.reader = { async read(input) {
    const result = await validReader.read(input);
    result.value.records[0].sourceObservedAt = null;
    return result;
  } };
  const c = await replaySourceRange(r, f.deps);
  assert.equal(c.state, 'QUARANTINED'); assert.equal(c.health.fetchOutcome, 'OK');
  assert.notEqual(c.health.parseOutcome, 'OK'); assert.deepEqual(await effects(r), []);
  const other = createTestPools();
  try {
    const g = setup(r, other.runtime); g.time(30000);
    const saved = await g.deps.store.exclusive(r, s => s.read()); assert.equal(saved.state, 'QUARANTINED');
    await reviewSourceQuarantine(g.deps.store, r, 'window', 'RETRY_SAME_PAGE', g.deps.authorized);
    assert.equal((await replaySourceRange(r, g.deps)).applied, 1);
    assert.equal((await effects(r)).length, 1);
  } finally { await other.close(); }
});

async function assertDownstream(r, pipeline, expected = 1) {
  const rows = (await pools.runtime.query(`SELECT i.permission, m.canonical, c.aircraft_id,
    c.observed_at_ms, c.decision_revision
    FROM source_ingestion.deliveries d
    JOIN source_ingestion.retained_inputs i USING (delivery_id)
    JOIN source_ingestion.message_revisions m ON m.source_delivery_id=d.delivery_id
    JOIN correlation.aircraft_link_revisions a ON a.message_id=m.message_id AND a.revision=1
    JOIN source_ingestion.private_contributions c ON c.message_id=m.message_id
    WHERE d.source_epoch=$1`, [r.sourceEpoch])).rows;
  assert.equal(rows.length, expected);
  for (const row of rows) {
    assert.equal(row.permission.evidenceReference, 'repository-synthetic-fixtures-only');
    assert.equal(row.canonical.observation.decodedText, 'Synthetic replay fixture');
    assert.equal(row.canonical.observation.observedAt.at, 1000);
    assert.equal(row.observed_at_ms, '1000');
    assert.equal(row.aircraft_id, 'ac_demo-001');
    assert.equal(row.decision_revision, '1');
  }
  // A later read clock must not turn historical observations into fresh status.
  const later = syntheticReplay(pools.runtime, r, () => 86_400_000).pipeline;
  assert.equal((await later.readPrivateStatus('ac_demo-001')).freshness, 'NONE');
  assert.ok((await pipeline.readPrivateStatus('ac_demo-001')).contributions.length >= expected);
}

for (const [maxAttempts, maxRetryMs, delay] of [[1, 60000, 4000], [5, 2000, 7000]])
  test(`quarantined provider deadline survives PostgreSQL restart and review (${maxAttempts}/${maxRetryMs})`, async () => {
    const r = request(), f = setup(r);
    f.deps.policy = { ...DEFAULT_REPLAY_POLICY, requestTimeoutMs: 1000, maxAttempts, maxRetryMs };
    f.deps.reader.read = async () => { f.time(15000); return { ok: false,
      error: { code: 'RETRY_AFTER', status: 429, retryAfterMs: delay } }; };
    const c = await replaySourceRange(r, f.deps);
    assert.equal(c.state, 'QUARANTINED'); assert.equal(c.nextAttemptAt, 15000 + delay);
    const other = createTestPools();
    try {
      const g = setup(r, other.runtime); g.time(15000 + delay - 1);
      await reviewSourceQuarantine(g.deps.store, r, 'window', 'RETRY_SAME_PAGE', g.deps.authorized);
      const reader = g.deps.reader;
      g.deps.reader = { read: async () => assert.fail('Cooldown must prevent fetch after review') };
      assert.equal((await replaySourceRange(r, g.deps)).requests, 0);
      g.time(15000 + delay); g.deps.reader = reader;
      assert.equal((await replaySourceRange(r, g.deps)).applied, 1);
    } finally { await other.close(); }
  });

test('partial two-record page exhausts small budget safely then recovers after explicit review', async () => {
  const r = { ...request(), limit: 2 }, f = setup(r);
  const pageReader = deps => {
    const reader = deps.reader;
    return { async read(input) {
      const result = await reader.read(input), first = result.value.records[0];
      return { ok: true, value: { records: [first, { ...first,
        originalSourceId: first.originalSourceId + '-two', deliveryId: first.deliveryId + '-two' }],
        bytes: 2000, nextCursor: null } };
    } };
  };
  f.deps.reader = pageReader(f.deps);
  const accept = f.deps.delivery.accept; let receipts = 0;
  f.deps.delivery.accept = async raw => ++receipts === 2
    ? { ok: false, error: { code: 'TRANSIENT_FAILURE' } } : accept(raw);
  const partial = await replaySourceRange(r, f.deps);
  assert.equal(partial.processed, 1); assert.equal(partial.cursor, null);
  assert.equal((await effects(r)).length, 1);
  const other = createTestPools();
  try {
    const g = setup(r, other.runtime); g.time(30000); g.deps.reader = pageReader(g.deps);
    // The full retried page exceeds the remaining allowance: no record is skipped.
    const exhausted = await replaySourceRange(r, g.deps);
    assert.equal(exhausted.state, 'QUARANTINED'); assert.equal(exhausted.cursor, null);
    assert.equal(exhausted.processed, 1); assert.equal((await effects(r)).length, 1);
    await reviewSourceQuarantine(g.deps.store, r, 'window', 'RETRY_SAME_PAGE', g.deps.authorized);
    g.time(50000);
    const final = await replaySourceRange(r, g.deps);
    assert.equal(final.state, 'COMPLETE'); assert.equal(final.applied, 2); assert.equal(final.duplicate, 1);
    await g.deps.pipeline.drain(); await assertDownstream(r, g.deps.pipeline, 2);
  } finally { await other.close(); }
});

test('permitted replay rejects mismatched retention scope before durable receipt', async () => {
  const r = request(), f = setup(r), reader = f.deps.reader;
  // Fixture grants cannot be repurposed as real-provider collection permissions.
  assert.throws(() => syntheticReplay(pools.runtime, { ...r, provider: 'airframes' }), /synthetic/);
  const { createPermittedReplayDelivery } = await import('../../src/modules/source-connectors/composition/create-permitted-replay-delivery.ts');
  const { scope, context, origin } = await import('./helpers/provider-fixture.mjs');
  const { delivery } = createPermittedReplayDelivery(pools.runtime, { find: async () => assert.fail('No correlation allowed') },
    { ...scope, sourceEpoch: 'wrong', retentionAllowed: true, purpose: 'PRIVATE_PROCESSING',
      evidenceReference: 'repository-synthetic-fixtures-only' }, { ...scope, sourceEpoch: r.sourceEpoch },
    raw => ({ ...context(raw), sourceEpoch: r.sourceEpoch }), () => origin);
  const page = await reader.read({ cursor: null, maxRecords: 2, signal: new AbortController().signal });
  assert.deepEqual(await delivery.accept(page.value.records[0]), { ok: false, error: { code: 'RIGHTS_REVOKED' } });
  assert.deepEqual(await effects(r), []);
});
