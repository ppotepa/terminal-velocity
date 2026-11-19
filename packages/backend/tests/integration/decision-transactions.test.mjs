import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { commitDecision } from '../../src/modules/aircraft-correlation/public/index.ts';
import { createPostgresDecisionTransaction } from '../../src/modules/aircraft-correlation/infrastructure/postgres/create-postgres-decision-transaction.ts';
import { createPostgresDecisionReader } from '../../src/modules/aircraft-correlation/infrastructure/postgres/create-postgres-decision-reader.ts';
import { runSqlTransaction } from '../../src/modules/database-transactions/public/index.ts';
import { createTestPools, resetTestData, uniqueId } from './helpers/database.mjs';
import { createDecisionEvent, makeDecision, FIXED_TIME } from './helpers/decisions.mjs';

const pools = createTestPools();
beforeEach(() => resetTestData(pools.admin));
after(() => pools.close());

function decisionWorker() {
  const child = fork(new URL('./helpers/decision-worker.mjs', import.meta.url), [],
    { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  let readyResolve, resultResolve, rejectResult;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const result = new Promise((resolve, reject) => { resultResolve = resolve; rejectResult = reject; });
  child.on('message', message => {
    if (message.type === 'READY') readyResolve();
    if (message.type === 'RESULT') resultResolve(message.result);
  });
  child.on('error', rejectResult);
  const exited = new Promise((resolve, reject) => child.once('exit', code => {
    if (code === 0) resolve();
    else { const error = new Error(`Decision worker exited with code ${code}`); rejectResult(error); reject(error); }
  }));
  return { child, ready, result, exited };
}

test('two independent Node processes race on the first decision; exactly one revision and event commit',
  { timeout: 15_000 }, async t => {
    const workers = [decisionWorker(), decisionWorker()];
    t.after(() => workers.forEach(worker => { if (worker.child.exitCode === null) worker.child.kill(); }));
    await Promise.all(workers.map(worker => worker.ready));
    const decision = makeDecision();
    workers.forEach(worker => worker.child.send({ decision, expectedRevision: null,
      decidedAt: FIXED_TIME, eventId: uniqueId('evt') }));
    const results = await Promise.all(workers.map(worker => worker.result));
    await Promise.all(workers.map(worker => worker.exited));
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.equal(results.find(result => !result.ok).error.code, 'STALE_REVISION');
    assert.equal((await pools.admin.query('SELECT count(*)::integer AS count FROM correlation.aircraft_link_revisions')).rows[0].count, 1);
    assert.equal((await pools.admin.query('SELECT count(*)::integer AS count FROM correlation.outbox')).rows[0].count, 1);
  });

test('concurrent revisions use CAS and preserve the complete immutable decision history', async () => {
  const first = await createDecisionEvent(pools.runtime);
  const id = first.payload.decision.messageId;
  const transaction = createPostgresDecisionTransaction(pools.runtime);
  const results = await Promise.all([uniqueId('ac'), uniqueId('ac')].map(aircraft =>
    commitDecision(makeDecision(id, aircraft), 1, 'directory/2', FIXED_TIME + 1,
      transaction, { next: () => uniqueId('evt') })));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.find(result => !result.ok).error.code, 'STALE_REVISION');
  const reader = createPostgresDecisionReader(pools.runtime);
  const history = await reader.readHistory(id);
  assert.deepEqual(history.map(record => record.revision), [1, 2]);
  assert.deepEqual(history[0], first.payload);
  assert.deepEqual(await reader.readCurrent(id), results.find(result => result.ok).value);
});

test('a real duplicate outbox key rolls back the new head and history and permits a clean retry', async () => {
  const first = await createDecisionEvent(pools.runtime);
  const decision = makeDecision();
  const transaction = createPostgresDecisionTransaction(pools.runtime);
  const failed = await commitDecision(decision, null, 'directory/1', FIXED_TIME,
    transaction, { next: () => first.eventId });
  assert.deepEqual(failed, { ok: false, error: { code: 'COMMIT_FAILED' } });
  const reader = createPostgresDecisionReader(pools.runtime);
  assert.equal(await reader.readCurrent(decision.messageId), null);
  assert.deepEqual(await reader.readHistory(decision.messageId), []);
  assert.equal((await pools.admin.query('SELECT count(*)::integer AS count FROM correlation.outbox')).rows[0].count, 1);
  const retry = await commitDecision(decision, null, 'directory/1', FIXED_TIME,
    transaction, { next: () => uniqueId('evt') });
  assert.equal(retry.ok, true);
  assert.equal(retry.value.revision, 1);
});

test('a decision without its outbox event cannot commit, and the leaked write capability expires', async () => {
  const transaction = createPostgresDecisionTransaction(pools.runtime);
  const decision = makeDecision();
  let leaked;
  await assert.rejects(() => transaction.run(async writes => {
    leaked = writes;
    await writes.read(decision.messageId);
    await writes.put({ decision, revision: 1, decidedAt: FIXED_TIME, directoryRevision: 'directory/1' });
  }), /incomplete|failed/);
  assert.equal(await createPostgresDecisionReader(pools.runtime).readCurrent(decision.messageId), null);
  await assert.rejects(() => leaked.read(decision.messageId), /expired/);
});

test('catching an aborted SQL statement cannot report success or retain earlier effects', async () => {
  const id = uniqueId('msg');
  let leaked;
  await assert.rejects(() => runSqlTransaction(pools.runtime, async sql => {
    leaked = sql;
    await sql.query('INSERT INTO availability.contributions (message_id, revision) VALUES ($1, 1)', [id]);
    try { await sql.query('SELECT 1 / 0'); } catch { /* A faulty caller attempts to swallow the SQL failure. */ }
    return 'incorrect-success';
  }), /failed SQL statement/);
  assert.equal((await pools.runtime.query('SELECT 1 FROM availability.contributions WHERE message_id = $1', [id])).rowCount, 0);
  await assert.rejects(() => leaked.query('SELECT 1'), /expired/);
  assert.equal(await runSqlTransaction(pools.runtime, async sql => (await sql.query('SELECT 7 AS value')).rows[0].value), 7);
});

test('returning with an unfinished SQL operation rolls back earlier effects instead of reporting success', async () => {
  const id = uniqueId('msg');
  let unfinished;
  await assert.rejects(() => runSqlTransaction(pools.runtime, async sql => {
    await sql.query('INSERT INTO availability.contributions (message_id, revision) VALUES ($1, 1)', [id]);
    unfinished = sql.query('SELECT pg_sleep(0.02)');
    return 'incorrect-success';
  }), /still in flight/);
  await unfinished;
  assert.equal((await pools.runtime.query('SELECT 1 FROM availability.contributions WHERE message_id = $1', [id])).rowCount, 0);
});

test('SQL effects survive a new pool connection only after a committed transaction', async () => {
  const event = await createDecisionEvent(pools.runtime);
  const connection = await pools.runtime.connect();
  try {
    const stored = await createPostgresDecisionReader(connection).readCurrent(event.payload.decision.messageId);
    assert.deepEqual(stored, event.payload);
  } finally { connection.release(); }
});
