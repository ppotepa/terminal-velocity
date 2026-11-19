import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createTestPools, resetTestData } from './helpers/database.mjs';
import { fixture, accept, context, scope, origin, NOW } from './helpers/provider-fixture.mjs';
import { createSyntheticProviderPipeline } from '../../src/modules/source-connectors/composition/create-synthetic-provider-pipeline.ts';
import { createFixtureCandidateDirectory } from '../../src/demo/infrastructure/fixture-candidate-directory.ts';
import { createFixtureFleet } from '../../src/demo/infrastructure/fixture-fleet.ts';
import { createPostgresDemoTracker } from '../../src/demo/composition/create-postgres-demo-tracker.ts';
import { SOURCE_IMPORT_CONSUMER, PRIVATE_AVAILABILITY_CONSUMER } from '../../src/modules/source-connectors/infrastructure/postgres/source-event-router.ts';
import { consumeRegisteredEvent } from '../../src/modules/event-delivery/infrastructure/consume-event.ts';
import { readSourceEvent } from '../../src/modules/source-connectors/infrastructure/postgres/read-source-event.ts';
import { acceptSourceDelivery, normalizeSourceObservation } from '../../src/modules/source-connectors/public/index.ts';
import { postgresSourceAcceptanceTransaction } from '../../src/modules/source-connectors/infrastructure/postgres/postgres-source-acceptance-transaction.ts';
const pools = createTestPools();
beforeEach(() => resetTestData(pools.admin));
after(() => pools.close());
const directory = createFixtureCandidateDirectory(createFixtureFleet());
const pipeline = (dir = directory, sql = pools.runtime) => createSyntheticProviderPipeline(sql, dir, () => NOW);
const count = async table => Number((await pools.admin.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
const messages = () => pools.admin.query('SELECT * FROM source_ingestion.message_revisions');
async function lease(p, consumer = SOURCE_IMPORT_CONSUMER) { await p.route(); return p.queue.leaseNext(consumer, 30_000); }
async function ready(eventId) {
  await pools.admin.query(`UPDATE event_delivery.deliveries SET state='READY',completed_at=NULL,
    lease_token=NULL,lease_until=NULL,next_attempt_at=clock_timestamp() WHERE event_id=$1`, [eventId]);
}

test('synthetic rendered record reaches a private decision and status with lineage; demo reads stay isolated', async () => {
  const p = pipeline(), raw = fixture(), receipt = await accept(p, raw);
  assert.equal(receipt.value.outcome, 'CREATED');
  const consumed = await p.consumeSource(await lease(p));
  assert.equal(consumed.result.outcome, 'IMPORTED');
  const imported = consumed.result;
  assert.equal(imported.sourceDeliveryId, receipt.value.deliveryId);
  assert.equal(imported.messageRevision, 1);
  assert.equal(imported.decision.revision, 1);
  assert.equal(await count('source_ingestion.private_contributions'), 0);
  await p.consumePrivate(await lease(p, PRIVATE_AVAILABILITY_CONSUMER));
  const status = await p.readPrivateStatus('ac_demo-001');
  assert.equal(status.freshness, 'RECENT');
  assert.equal(status.contributions.length, 1);
  assert.equal(status.contributions[0].source_delivery_id, receipt.value.deliveryId);
  assert.deepEqual(status.contributions[0].provenance, { pageUrl: origin.pageUrl, parserVersion: origin.parserVersion });
  const stored = (await messages()).rows[0];
  assert.equal(stored.canonical.observation.decodedText, raw.text);
  assert.equal(stored.canonical.provenance.originalSourceId, raw.originalSourceId);
  assert.equal(stored.canonical.provenance.decoder.version, raw.decoder.version);
  assert.equal(stored.canonical.observation.dataLevel, 'PROVIDER_MESSAGE');
  assert.equal('receiverId' in stored.canonical.observation, false);
  assert.equal(await count('message_ingestion.messages'), 0);
  assert.equal(await count('availability.contributions'), 0);
  assert.equal(await p.queue.fanOut(['demo-availability-v1'], 100), 0);
  const demo = await createPostgresDemoTracker({ connectionString: process.env.TEST_RUNTIME_DATABASE_URL, now: () => NOW, startWorker: false });
  try {
    assert.equal((await demo.tracker.getMessage(imported.messageId)).ok, false);
    assert.equal(JSON.stringify(await demo.tracker.getMessages('ac_demo-001')).includes(imported.messageId), false);
    assert.equal(JSON.stringify(await demo.tracker.getAircraft('ac_demo-001')).includes('RECENT'), false);
  } finally { await demo.close(); }
});

test('two workers consume the same lease once, and committed replay cannot duplicate message effects', async () => {
  const p = pipeline(), raw = fixture();
  assert.equal((await accept(p, raw)).value.outcome, 'CREATED');
  assert.equal((await accept(p, raw, { ...origin, pageUrl: 'https://synthetic.example/overlap' })).value.outcome, 'DUPLICATE');
  const claim = await lease(p);
  const outcomes = await Promise.all([p.consumeSource(claim), pipeline().consumeSource(claim)]);
  assert.deepEqual(outcomes.map(x => x.outcome).sort(), ['APPLIED','STALE_LEASE']);
  await ready(claim.eventId);
  assert.equal((await p.consumeSource(await lease(p))).outcome, 'DUPLICATE');
  await p.drain();
  for (const table of ['source_ingestion.message_revisions','correlation.aircraft_link_revisions','correlation.outbox',
    'source_ingestion.private_contributions']) assert.equal(await count(table), 1, table);
  assert.equal(await count('event_delivery.consumer_inbox'), 2);
});

test('identical text at distinct observation times and source epochs stays distinct', async () => {
  const p = pipeline(), first = fixture(), next = fixture();
  next.sourceObservedAt.at = '2026-11-19T09:00:00Z';
  assert.equal(first.text, next.text);
  assert.ok((await accept(p, first)).ok); assert.ok((await accept(p, next)).ok);
  const otherScope = { ...scope, sourceEpoch: 'v2' };
  assert.ok((await p.acceptFixture(first, { ...context(first), sourceEpoch: 'v2' }, otherScope, origin)).ok);
  await p.drain();
  const rows = (await messages()).rows;
  assert.equal(new Set(rows.map(x => x.message_id)).size, 3);
  assert.equal((await p.readPrivateStatus('ac_demo-001')).contributions.length, 3);
  assert.equal(await count('correlation.outbox'), 3);
});

test('unknown, ambiguous and conflicting identifiers preserve decision evidence without private confirmation', async () => {
  for (const expected of ['UNMATCHED','AMBIGUOUS','CONFLICTED']) {
    await resetTestData(pools.admin);
    const raw = fixture();
    let dir = directory;
    if (expected === 'UNMATCHED') raw.aircraft = { icao24: 'FFFFFF' };
    if (expected === 'CONFLICTED') raw.aircraft.registration = 'DEMO-002';
    if (expected === 'AMBIGUOUS') {
      const fleet = createFixtureFleet();
      dir = createFixtureCandidateDirectory([...fleet, { ...fleet[0], aircraftId: 'ac_duplicate' }]);
    }
    const p = pipeline(dir);
    assert.ok((await accept(p, raw)).ok);
    const result = (await p.consumeSource(await lease(p))).result;
    assert.equal(result.outcome, expected);
    assert.equal(result.decision.decision.status, expected);
    assert.equal(result.decision.directoryRevision, 'synthetic-fleet/1');
    assert.equal(result.decision.revision, 1);
    await p.drain();
    assert.equal((await p.readPrivateStatus('ac_demo-001')).freshness, 'NONE');
  }
});

test('invalid ICAO is rejected; incomplete candidates roll back inbox, facts, decision and outbox then recover', async () => {
  const raw = fixture(), p = pipeline();
  assert.equal((await accept(p, { ...raw, aircraft: { icao24: 'invalid' } })).ok, false);
  assert.equal(await count('source_ingestion.deliveries'), 0);
  await accept(p, raw);
  const broken = pipeline({ find: async () => ({ completeness: 'INCOMPLETE', reason: 'UNAVAILABLE', revision: 'incomplete' }) });
  const claim = await lease(broken);
  await assert.rejects(broken.consumeSource(claim), /CANDIDATE_SET_INCOMPLETE/);
  for (const table of ['event_delivery.consumer_inbox','source_ingestion.message_revisions','correlation.outbox'])
    assert.equal(await count(table), 0);
  await p.queue.retry(claim, { code: 'DIRECTORY_UNAVAILABLE', delayMs: 0 });
  assert.equal((await p.consumeSource(await lease(p))).result.outcome, 'IMPORTED');
});

test('a forced SQL failure after effects rolls back inbox and message writes', async () => {
  const p = pipeline(); await accept(p);
  const claim = await lease(p);
  await assert.rejects(consumeRegisteredEvent(pools.runtime, claim, readSourceEvent, async (sql, event) => {
    await sql.query(`INSERT INTO source_ingestion.message_revisions
      (message_id,revision,source_delivery_id,transformation_id,canonical) VALUES ($1,1,$2,'provider-message/1',$3)`,
    [event.messageId, event.sourceDeliveryId, event.canonical]);
    await sql.query('SELECT 1/0');
  }), { code: '22012' });
  assert.equal(await count('source_ingestion.message_revisions'), 0);
  assert.equal(await count('event_delivery.consumer_inbox'), 0);
  assert.equal((await p.consumeSource(claim)).result.outcome, 'IMPORTED');
});

test('metadata-only deliveries, missing observation time and unsupported levels quarantine without invented facts', async () => {
  const p = pipeline(), raw = fixture();
  const normalized = normalizeSourceObservation(raw, context(raw), scope.capabilities).value;
  const receipt = await acceptSourceDelivery(scope, postgresSourceAcceptanceTransaction(pools.runtime), normalized.observation, origin);
  assert.ok(receipt.ok);
  assert.equal((await p.consumeSource(await lease(p))).result.reason, 'RETENTION_NOT_PERMITTED');
  const missing = fixture(); delete missing.sourceObservedAt;
  assert.ok((await accept(p, missing)).ok);
  assert.equal((await p.consumeSource(await lease(p))).result.reason, 'MISSING_OBSERVATION_TIME');
  const frame = fixture(); frame.dataLevel = 'FRAME'; delete frame.text; frame.frameBytesBase64 = 'AQID';
  assert.ok((await accept(p, frame)).ok);
  assert.equal((await p.consumeSource(await lease(p))).result.reason, 'UNSUPPORTED_LEVEL');
  assert.equal(await count('source_ingestion.message_revisions'), 0);
  assert.equal(await count('source_ingestion.import_quarantine'), 3);
  await assert.rejects(p.acceptFixture(raw, { ...context(raw), provider: 'airframes' }, scope, origin), /synthetic/);
});

for (const phase of ['LEASED','COMMITTED']) test(`worker killed at ${phase} recovers across process restart`, { timeout: 15000 }, async t => {
  const p = pipeline(), raw = fixture(); await accept(p, raw);
  const child = fork(new URL('./helpers/provider-worker.mjs', import.meta.url), { stdio: ['ignore','ignore','inherit','ipc'] });
  t.after(() => { if (child.exitCode === null && !child.signalCode) child.kill(); });
  const exited = once(child, 'exit');
  await once(child, 'message'); child.send({ phase });
  assert.deepEqual(await exited, [null,'SIGKILL']);
  if (phase === 'LEASED') await pools.admin.query(`UPDATE event_delivery.deliveries
    SET lease_until=clock_timestamp()-interval '1 second' WHERE state='LEASED'`);
  assert.equal((await accept(p, raw)).value.outcome, 'DUPLICATE');
  await pipeline().drain();
  assert.equal(await count('source_ingestion.message_revisions'), 1);
  assert.equal(await count('correlation.outbox'), 1);
  assert.equal((await p.readPrivateStatus('ac_demo-001')).freshness, 'RECENT');
});

test('runtime cannot mutate immutable provider facts, canonical evidence or registry provenance', async () => {
  for (const table of ['source_ingestion.message_revisions','source_ingestion.synthetic_inputs','event_delivery.events']) {
    await assert.rejects(pools.runtime.query(`DELETE FROM ${table}`), { code: '42501' });
  }
  await assert.rejects(pools.runtime.query('UPDATE source_ingestion.message_revisions SET canonical=canonical'), { code: '42501' });
  await assert.rejects(pools.runtime.query('UPDATE source_ingestion.outbox SET normalized_v1_sha256=normalized_v1_sha256'), { code: '42501' });
});

test('separate deliveries of one provider message share a revision and preserve every immutable delivery link', async () => {
  const p = pipeline(), raw = fixture();
  const second = { ...raw, deliveryId: raw.deliveryId + '-transport-2' };
  assert.ok((await accept(p, raw)).ok); assert.ok((await accept(p, second)).ok);
  const claims = [await lease(p), await lease(p)];
  const results = await Promise.all(claims.map(claim => p.consumeSource(claim)));
  assert.deepEqual(results.map(r => r.result.outcome).sort(), ['DUPLICATE','IMPORTED']);
  assert.equal(results[0].result.messageId, results[1].result.messageId);
  assert.equal(await count('source_ingestion.message_sources'), 2);
  assert.equal(await count('source_ingestion.message_revisions'), 1);
  assert.equal(await count('correlation.outbox'), 1);
  const conflict = { ...raw, deliveryId: raw.deliveryId + '-transport-3', text: 'Conflicting synthetic content' };
  assert.ok((await accept(p, conflict)).ok);
  assert.equal((await p.consumeSource(await lease(p))).result.reason, 'IDENTITY_CONFLICT');
  assert.equal(await count('source_ingestion.message_sources'), 2);
  assert.equal(await count('correlation.outbox'), 1);
});

test('reimporting a backfill does not refresh status and changed normalized registration cannot replay an old receipt', async () => {
  const p = pipeline(), raw = fixture(); raw.sourceObservedAt.at = '2026-11-18T10:00:00Z';
  assert.ok((await accept(p, raw)).ok);
  const later = { ...context(raw), ingestedAt: { ...context(raw).ingestedAt, at: '2026-11-19T11:00:00Z' }, retrievedAt: NOW + 1000 };
  assert.equal((await p.acceptFixture(raw, later, scope, { ...origin, ingestedAt: NOW + 3_600_000 })).value.outcome, 'DUPLICATE');
  // Keep the envelope digest fixed to verify the full normalized evidence comparison itself.
  const changed = { ...raw, aircraft: { ...raw.aircraft, registration: 'DEMO-002' } };
  assert.equal((await p.acceptFixture(changed, context(raw), scope, origin)).error.code, 'CONFLICTED');
  await p.drain();
  assert.equal((await p.readPrivateStatus('ac_demo-001')).freshness, 'NONE');
});

test('a disconnected COMMIT response leaves one durable import and resolves safely on retry', async () => {
  const p = pipeline(); await accept(p); const claim = await lease(p);
  const lostResponsePool = {
    async connect() {
      const client = await pools.runtime.connect();
      return { async query(text, values) {
        const result = await client.query(text, values);
        if (text === 'COMMIT') throw new Error('Simulated lost COMMIT response');
        return result;
      }, release: error => client.release(error) };
    },
  };
  await assert.rejects(pipeline(directory, lostResponsePool).consumeSource(claim), /lost COMMIT/);
  assert.equal((await p.consumeSource(claim)).outcome, 'STALE_LEASE');
  await ready(claim.eventId);
  assert.equal((await p.consumeSource(await lease(p))).outcome, 'DUPLICATE');
  assert.equal(await count('source_ingestion.message_revisions'), 1);
  assert.equal(await count('correlation.outbox'), 1);
});

test('private projection rolls back on failure, replays once and preserves correction tombstones against stale events', async () => {
  const { projectPrivateDecision } = await import('../../src/modules/source-connectors/infrastructure/postgres/private-availability.ts');
  const { runSqlTransaction } = await import('../../src/modules/database-transactions/public/index.ts');
  const { createDecisionEvent, makeDecision } = await import('./helpers/decisions.mjs');
  const p = pipeline(); await accept(p);
  const imported = (await p.consumeSource(await lease(p))).result;
  const claim = await lease(p, PRIVATE_AVAILABILITY_CONSUMER);
  await assert.rejects(p.queue.consume(claim, async (sql, event) => {
    await projectPrivateDecision(sql, event.payload); await sql.query('SELECT 1/0');
  }), { code: '22012' });
  assert.equal(await count('source_ingestion.private_contributions'), 0);
  assert.equal(await count('event_delivery.consumer_inbox'), 1);
  assert.equal(await p.consumePrivate(claim), 'APPLIED');
  await ready(claim.eventId);
  assert.equal(await p.consumePrivate(await lease(p, PRIVATE_AVAILABILITY_CONSUMER)), 'DUPLICATE');
  await createDecisionEvent(pools.runtime, { decision: makeDecision(imported.messageId, 'ac_demo-002'), expectedRevision: 1, decidedAt: NOW });
  await p.drain();
  assert.equal((await p.readPrivateStatus('ac_demo-001')).freshness, 'NONE');
  assert.equal((await p.readPrivateStatus('ac_demo-002')).freshness, 'RECENT');
  await createDecisionEvent(pools.runtime, { decision: makeDecision(imported.messageId), expectedRevision: 2, decidedAt: NOW });
  await p.drain();
  await runSqlTransaction(pools.runtime, sql => projectPrivateDecision(sql, imported.decision));
  assert.equal((await p.readPrivateStatus('ac_demo-001')).freshness, 'NONE');
  assert.equal((await p.readPrivateStatus('ac_demo-002')).freshness, 'NONE');
  const row = (await pools.admin.query('SELECT * FROM source_ingestion.private_contributions')).rows[0];
  assert.equal(row.aircraft_id, null); assert.equal(Number(row.decision_revision), 3);
  const sourceEvent = (await pools.admin.query('SELECT event_id FROM event_delivery.deliveries WHERE consumer_id=$1',
    [SOURCE_IMPORT_CONSUMER])).rows[0].event_id;
  await ready(sourceEvent);
  const replay = await p.consumeSource(await lease(p));
  assert.equal(replay.result.outcome, 'DUPLICATE');
  assert.equal(replay.result.decision.revision, 1);
  assert.equal(replay.result.sourceDeliveryId, imported.sourceDeliveryId);
});

test('injected rendered page reader feeds accepted source events into private correlation without a provider API', async () => {
  const { randomUUID } = await import('node:crypto');
  const { createProviderConnector } = await import('../../src/modules/source-connectors/composition/create-provider-connector.ts');
  const { normalizeRenderedDelivery } = await import('../../src/modules/source-connectors/infrastructure/airframes/normalize-rendered-delivery.ts');
  const raw = fixture(), p = pipeline();
  const source = 'https://app.airframes.io/messages/live';
  const card = { icao: 'D00001', text: raw.text, station: null, messagePath: '/messages/' + raw.originalSourceId,
    evidence: { sourceObservedAt: raw.sourceObservedAt.at, receiverReceivedAt: raw.receiverReceivedAt.at,
      providerPublishedAt: raw.providerPublishedAt.at, uncertaintyMs: '500', registration: 'DEMO-001', bearer: 'VDL2' } };
  const connector = createProviderConnector('crawl', card.icao, { kind: 'SYNTHETIC_PAGE', read: async () => ({ status: 200,
    body: { status: 'OBSERVED', source, icao: card.icao, messages: [card] } }) });
  let receipt;
  const outcome = await connector.start(async delivery => {
    const ingestedAt = Date.now();
    const canonical = normalizeRenderedDelivery(delivery, { ...scope,
      ingestedAt: { at: new Date(ingestedAt).toISOString(), basis: 'INGESTED', precision: 'MILLISECOND', uncertaintyMs: 0 } }, scope.capabilities);
    assert.ok(canonical.ok, JSON.stringify(canonical));
    receipt = await acceptSourceDelivery(scope,
      postgresSourceAcceptanceTransaction(pools.runtime, randomUUID, canonical.value), canonical.value.observation,
      { pageUrl: delivery.source, parserVersion: 'airframes-rendered-extractor-v1', retrievedAt: delivery.retrievedAt, ingestedAt });
    return receipt;
  });
  assert.equal(outcome, 'COMPLETE'); assert.equal(receipt.value.outcome, 'CREATED');
  assert.equal(connector.health().accepted, 1);
  await p.drain();
  const status = await p.readPrivateStatus('ac_demo-001');
  assert.equal(status.freshness, 'RECENT');
  assert.equal(status.contributions[0].source_delivery_id, receipt.value.deliveryId);
  assert.equal((await messages()).rows[0].canonical.provenance.originalSourceId, card.messagePath);
});
