import test from 'node:test';
import assert from 'node:assert/strict';
import { createPermittedProviderPipeline } from '../src/modules/source-connectors/composition/create-permitted-provider-pipeline.ts';
import { fixture, scope, NOW } from './integration/helpers/provider-fixture.mjs';

function inputs() {
  const raw = fixture();
  return {
    delivery: { source: 'https://app.airframes.io/messages/live', retrievedAt: NOW,
      raw: { icao: 'D00001', messagePath: '/messages/synthetic-example', text: raw.text, station: null,
        evidence: { uncertaintyMs: '500', sourceObservedAt: raw.sourceObservedAt.at, receiverReceivedAt: raw.receiverReceivedAt.at } } },
    context: { ...scope, ingestedAt: { at: new Date(NOW).toISOString(), basis: 'INGESTED', precision: 'MILLISECOND', uncertaintyMs: 0 } },
    permission: { ...scope, retentionAllowed: true, purpose: 'PRIVATE_PROCESSING', evidenceReference: 'synthetic-fixtures-only' },
  };
}
function databaseUnavailable(permission) {
  let connections = 0;
  const pool = { async connect() { connections++; throw new Error('Database unavailable'); } };
  return { pipeline: createPermittedProviderPipeline(pool, {}, permission, () => NOW), connections: () => connections };
}

test('valid rendered delivery reaches acceptance and reports unavailable storage without a false ACK', async () => {
  const { delivery, context, permission } = inputs();
  const p = databaseUnavailable(permission);
  assert.deepEqual(await p.pipeline.acceptRendered(delivery, context, scope), { ok: false, error: { code: 'UNAVAILABLE' } });
  assert.equal(p.connections(), 1);
});

test('rendered permission and verified source scope are checked before connecting to storage', async () => {
  const { delivery, context, permission } = inputs();
  for (const denied of [undefined, { ...permission, retentionAllowed: false }, { ...permission, provider: 'different' }]) {
    const p = databaseUnavailable(denied);
    await assert.rejects(p.pipeline.acceptRendered(delivery, context, scope), /Retention permission/);
    assert.equal(p.connections(), 0);
  }
  const p = databaseUnavailable(permission);
  assert.deepEqual(await p.pipeline.acceptRendered(delivery, context, { ...scope, accountScope: 'different' }),
    { ok: false, error: { code: 'INVALID', field: 'sourceScope' } });
  assert.equal(p.connections(), 0);
});

test('rendered validation rejects invalid page provenance, aircraft, missing evidence and future retrieval', async () => {
  const { delivery, context, permission } = inputs();
  const p = databaseUnavailable(permission);
  for (const bad of [{ ...delivery, source: 'https://synthetic.example/wrong' },
    { ...delivery, raw: { ...delivery.raw, icao: 'invalid' } },
    { ...delivery, raw: { ...delivery.raw, evidence: {} } }, { ...delivery, retrievedAt: NOW + 1 }]) {
    assert.equal((await p.pipeline.acceptRendered(bad, context, scope)).ok, false);
  }
  assert.equal(p.connections(), 0);
});
