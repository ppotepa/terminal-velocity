import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { acceptSourceDelivery, parseSourceObservation, sourceCapabilities } from '../../src/modules/source-connectors/public/index.ts';
import { postgresSourceAcceptanceTransaction } from '../../src/modules/source-connectors/infrastructure/postgres/postgres-source-acceptance-transaction.ts';
import { postgresSourceDeliveryStore } from '../../src/modules/source-connectors/infrastructure/postgres/postgres-source-delivery-store.ts';
import { createTestPools, uniqueId } from './helpers/database.mjs';

const pools = createTestPools();
after(() => pools.close());
const transaction = postgresSourceAcceptanceTransaction(pools.runtime);
const scope = {
  sourceId: 'src_fixture', provider: 'fixture', accountScope: 'a', sourceEpoch: 'epoch-1',
  capabilities: sourceCapabilities({
    revision: 1, supportedDataLevels: ['PROVIDER_MESSAGE','RECEPTION'],
    coverage: { kind: 'STATION_SCOPED', receiverIds: ['a','b'] }, receiverCoverageCompleteness: 'COMPLETE',
    sampling: { kind: 'NOT_DECLARED' }, messageDirection: 'UNKNOWN', bearer: null, protocolStack: [],
  }).value,
};
const origin = { pageUrl: 'https://fixture.example/page/1', parserVersion: 'v1', retrievedAt: 2000, ingestedAt: 2100 };
function envelope() {
  return {
    schemaVersion: 1, dataLevel: 'PROVIDER_MESSAGE', sourceId: scope.sourceId,
    sourceDeliveryId: { provider: scope.provider, accountScope: scope.accountScope,
      sourceEpoch: scope.sourceEpoch, externalId: uniqueId('test') },
    payloadDigest: 'a'.repeat(64), capabilitiesRevision: 1,
    receivedAt: { at: '1970-01-01T00:00:01Z', basis: 'RECEIVED', precision: 'SECOND', uncertaintyMs: 100 },
    decodedText: 'Synthetic text', protocolStack: ['VDL2','ACARS'],
  };
}
function accept(item, provenance = origin, tx = transaction) { return acceptSourceDelivery(scope, tx, item, provenance); }
async function effects(item) {
  return (await pools.admin.query(`SELECT d.delivery_id, e.event_id, e.payload, e.canonical_v1_sha256
    FROM source_ingestion.deliveries d LEFT JOIN source_ingestion.outbox e USING (delivery_id)
    WHERE source_id=$1 AND provider_id=$2 AND account_scope=$3 AND source_epoch=$4 AND external_id=$5`,
  [item.sourceId, item.sourceDeliveryId.provider, item.sourceDeliveryId.accountScope, item.sourceDeliveryId.sourceEpoch,
    item.sourceDeliveryId.externalId])).rows;
}
function worker(t) {
  const child = fork(new URL('./helpers/source-acceptance-worker.mjs', import.meta.url),
    { stdio: ['ignore','ignore','inherit','ipc'] });
  t.after(() => { if (child.exitCode === null && !child.signalCode) child.kill(); });
  const ready = once(child, 'message');
  const exited = once(child, 'exit');
  return { child, ready, exited };
}

test('two Node processes race across overlapping pages and receive the original committed receipt', { timeout: 15000 }, async t => {
  const workers = [worker(t), worker(t)];
  await Promise.all(workers.map(w => w.ready));
  const item = envelope();
  const results = await Promise.all(workers.map(async (w, page) => {
    const result = once(w.child, 'message');
    w.child.send({ envelope: item, scope, origin: { ...origin, pageUrl: 'https://fixture.example/page/' + page,
      retrievedAt: origin.retrievedAt + page, ingestedAt: origin.ingestedAt + page } });
    return (await result)[0];
  }));
  await Promise.all(workers.map(w => w.exited));
  assert.deepEqual(results.map(r => r.value.outcome).sort(), ['CREATED','DUPLICATE']);
  assert.equal(results[0].value.deliveryId, results[1].value.deliveryId);
  assert.deepEqual(results[0].value.origin, results[1].value.origin);
  const rows = await effects(item);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].payload, { deliveryId: rows[0].delivery_id });
  assert.match(rows[0].canonical_v1_sha256, /^[0-9a-f]{64}$/);
});

test('a worker killed after commit and before reply can be retried without another event', { timeout: 15000 }, async t => {
  const w = worker(t), item = envelope();
  await w.ready;
  w.child.send({ scope, envelope: item, origin, loseReply: true });
  assert.deepEqual(await w.exited, [null, 'SIGKILL']);
  const retry = await accept(item);
  assert.equal(retry.value.outcome, 'DUPLICATE');
  const rows = await effects(item);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].delivery_id, retry.value.deliveryId);
});

test('a validated #5 observation and its serialized envelope produce the same acceptance receipt', async () => {
  const item = envelope();
  item.observedAt = { ...item.receivedAt, basis: 'OBSERVED' };
  const parsed = parseSourceObservation(item);
  assert.ok(parsed.ok);
  const created = await accept(parsed.value);
  assert.equal(created.value.outcome, 'CREATED');
  const retry = await accept(item);
  assert.equal(retry.value.outcome, 'DUPLICATE');
  assert.equal(retry.value.deliveryId, created.value.deliveryId);
  for (const change of [{ at: 999 }, { iso: 'not UTC' }, { extra: true }]) {
    const inconsistent = { ...parsed.value, observedAt: { ...parsed.value.observedAt, ...change } };
    assert.deepEqual((await accept(inconsistent)).error, { code: 'INVALID', field: 'observation' });
  }
});

test('canonical facts conflict even with an unchanged provider digest; query and page retrieval clocks do not', async () => {
  const item = envelope();
  const created = await accept(item);
  assert.equal(created.value.outcome, 'CREATED');
  for (const change of [{ decodedText: 'Different synthetic text' }, { payloadDigest: 'b'.repeat(64) },
    { protocolStack: ['ACARS','VDL2'] }, { receivedAt: { ...item.receivedAt, uncertaintyMs: 0 } },
    { decoderVersion: 'other' }, { addressHints: { callsign: 'ABC' } }])
    assert.deepEqual((await accept({ ...item, ...change })).error, { code: 'CONFLICTED', deliveryId: created.value.deliveryId });
  assert.equal((await accept(item, { ...origin, parserVersion: 'v2' })).error.code, 'CONFLICTED');
  const retry = await accept({ ...item, receivedAt: { ...item.receivedAt, at: '1970-01-01T00:00:01.000Z' } },
    { ...origin, pageUrl: origin.pageUrl + '?cursor=x', retrievedAt: 3000, ingestedAt: 3001 });
  assert.equal(retry.value.outcome, 'DUPLICATE');
  assert.deepEqual(retry.value.origin, created.value.origin);
  assert.equal((await effects(item)).length, 1);
});

test('receptions with distinct scoped keys survive equal content, while a receiver change under one key conflicts', async () => {
  const { decodedText, protocolStack, ...base } = envelope();
  const item = { ...base, dataLevel: 'RECEPTION', receiverId: 'a' };
  assert.equal((await accept(item)).value.outcome, 'CREATED');
  assert.equal((await accept({ ...item, receiverId: 'b' })).error.code, 'CONFLICTED');
  const next = { ...item, receiverId: 'b', sourceDeliveryId: { ...item.sourceDeliveryId, externalId: uniqueId('station-b') } };
  assert.equal((await accept(next)).value.outcome, 'CREATED');
  const scope2 = { ...scope, sourceEpoch: 'epoch-2' };
  assert.equal((await acceptSourceDelivery(scope2, transaction,
    { ...item, sourceDeliveryId: { ...item.sourceDeliveryId, sourceEpoch: scope2.sourceEpoch } }, origin)).value.outcome, 'CREATED');
});

test('invalid evidence, unconfigured capabilities and mismatched source scope fail before storage', async () => {
  const item = envelope();
  const unused = { run() { assert.fail('Transaction should not begin'); } };
  for (const [update, field] of [
    [{ payloadDigest: 'bad' }, 'observation'], [{ receivedAt: { ...item.receivedAt, at: 'invalid' } }, 'observation'],
    [{ sourceId: 'src_other' }, 'sourceScope'], [{ sourceDeliveryId: { ...item.sourceDeliveryId, provider: 'other' } }, 'sourceScope'],
    [{ capabilitiesRevision: 2 }, 'capabilities'],
  ]) assert.deepEqual((await accept({ ...item, ...update }, origin, unused)).error, { code: 'INVALID', field });
  for (const change of [{ retrievedAt: 3000 }, { parserVersion: '' }, { pageUrl: 'file:///private' }])
    assert.deepEqual((await accept(item, { ...origin, ...change }, unused)).error, { code: 'INVALID', field: 'origin' });
  const { decodedText, protocolStack, ...base } = item;
  for (const data of [{ dataLevel: 'FRAME', frameBytesBase64: 'AQID' }, { dataLevel: 'RECEPTION', receiverId: 'unknown' }])
    assert.equal((await accept({ ...base, ...data }, origin, unused)).error.field, 'capabilities');
});

test('outbox uniqueness failure rolls back delivery and allows safe retry; an orphan cannot be inserted', async () => {
  const tx = postgresSourceAcceptanceTransaction(pools.runtime, () => fixedEvent);
  const fixedEvent = randomUUID();
  const item = envelope();
  assert.equal((await accept(envelope(), origin, tx)).value.outcome, 'CREATED');
  assert.equal((await accept(item, origin, tx)).error.code, 'UNAVAILABLE');
  assert.deepEqual(await effects(item), []);
  assert.equal((await accept(item)).value.outcome, 'CREATED');
  await assert.rejects(pools.runtime.query(`INSERT INTO source_ingestion.outbox(delivery_id,stream_revision,event_type,payload)
    VALUES ($1,1,'source.delivery-accepted.v1',jsonb_build_object('deliveryId',$1::uuid))`, [randomUUID()]), { code: '23503' });
});

test('legacy rows without canonical equivalence evidence fail closed and transaction capabilities expire', async () => {
  const item = envelope();
  const parsed = parseSourceObservation(item).value;
  const id = await postgresSourceDeliveryStore(pools.runtime).appendDelivery(parsed, origin, { state: 'ACCEPTED' });
  assert.deepEqual((await accept(item)).error, { code: 'CONFLICTED', deliveryId: id });
  let captured;
  await transaction.run(parsed, origin, async locked => { captured = locked; });
  await assert.rejects(captured.readPrevious(), /expired/);
  await assert.rejects(captured.append(), /expired/);
});
