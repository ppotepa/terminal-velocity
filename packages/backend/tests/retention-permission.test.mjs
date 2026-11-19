import test from 'node:test';
import assert from 'node:assert/strict';
import { permitsRetention, normalizeSourceObservation } from '../src/modules/source-connectors/public/index.ts';
import { createPermittedProviderPipeline } from '../src/modules/source-connectors/composition/create-permitted-provider-pipeline.ts';
import { postgresSourceAcceptanceTransaction } from '../src/modules/source-connectors/infrastructure/postgres/postgres-source-acceptance-transaction.ts';
import { fixture, context, scope, origin } from './integration/helpers/provider-fixture.mjs';

const configured = { ...scope, sourceId: 'src_test-provider', provider: 'test-provider' };
const permission = { sourceId: configured.sourceId, provider: configured.provider,
  accountScope: configured.accountScope, sourceEpoch: configured.sourceEpoch,
  purpose: 'PRIVATE_PROCESSING', retentionAllowed: true, evidenceReference: 'test-only-synthetic-content-permission' };
const raw = fixture(), ctx = { ...context(raw), ...configured };
const canonical = normalizeSourceObservation(raw, ctx, configured.capabilities).value;

test('retention permission matches all namespace dimensions and private purpose', () => {
  assert.equal(permitsRetention(permission, canonical.observation), true);
  for (const denied of [undefined, { ...permission, retentionAllowed: false },
    { ...permission, purpose: 'PUBLIC' }, { ...permission, evidenceReference: '' },
    ...['sourceId','provider','accountScope','sourceEpoch'].map(key => ({ ...permission, [key]: 'different' }))])
    assert.equal(permitsRetention(denied, canonical.observation), false);
});

test('missing permission fails before any SQL at both composition and retention adapter', async () => {
  const pool = { connect() { assert.fail('Permission denial must not access SQL'); } };
  const p = createPermittedProviderPipeline(pool, {}, undefined);
  await assert.rejects(p.accept(raw, ctx, configured, origin), /Retention permission/);
  const tx = postgresSourceAcceptanceTransaction(pool, undefined, { canonical, permission: undefined });
  assert.throws(() => tx.run(canonical.observation, origin, () => {}), /Retention permission/);
});

test('normal composition captures operator permission independently of subsequent configuration mutation', async () => {
  let connected = 0;
  const pool = { async connect() { connected++; throw new Error('Fixture SQL unavailable'); } };
  const grant = { ...permission };
  const p = createPermittedProviderPipeline(pool, {}, grant);
  grant.provider = 'changed';
  const result = await p.accept(raw, ctx, configured, origin);
  assert.equal(result.error.code, 'UNAVAILABLE');
  assert.equal(connected, 1);
});
