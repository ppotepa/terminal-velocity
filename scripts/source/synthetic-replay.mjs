import { createHash } from 'node:crypto';
import { createPermittedReplayDelivery } from '../../packages/backend/src/modules/source-connectors/composition/create-permitted-replay-delivery.ts';
import { createFixtureCandidateDirectory } from '../../packages/backend/src/demo/infrastructure/fixture-candidate-directory.ts';
import { createFixtureFleet } from '../../packages/backend/src/demo/infrastructure/fixture-fleet.ts';
import { sourceCapabilities } from '../../packages/backend/src/modules/source-connectors/public/index.ts';

/** Fixed synthetic contract fixture; never selected by the user-facing messages crawl. */
export function syntheticReplay(pool, request, now = Date.now) {
  const scope = { sourceId: request.sourceId, provider: request.provider, accountScope: request.account,
    sourceEpoch: request.sourceEpoch, capabilities: sourceCapabilities({ revision: 1,
      supportedDataLevels: ['PROVIDER_MESSAGE'], coverage: { kind: 'UNKNOWN' },
      receiverCoverageCompleteness: 'UNKNOWN', sampling: { kind: 'NOT_DECLARED' },
      messageDirection: 'UNKNOWN', bearer: null, protocolStack: [] }).value };
  const observed = request.from;
  if (request.mode !== 'SYNTHETIC' || request.sourceId !== 'src_synthetic'
    || request.provider !== 'synthetic' || request.account !== 'private-fixture')
    throw new Error('Only explicit repository synthetic fixtures are configured.');
  const record = { schemaVersion: 'synthetic-rendered-record-v1', dataLevel: 'PROVIDER_MESSAGE',
    originalSourceId: `fixture-${observed}`, deliveryId: `fixture-${observed}`,
    sourceDescription: 'Synthetic replay fixture', decoder: { name: 'synthetic-extractor', version: '1' },
    text: 'Synthetic replay fixture', aircraft: { icao24: 'D00001', registration: 'DEMO-001' },
    receiverReceivedAt: { at: new Date(observed).toISOString(), basis: 'RECEIVED', precision: 'MILLISECOND', uncertaintyMs: 0 },
    sourceObservedAt: { at: new Date(observed).toISOString(), basis: 'OBSERVED', precision: 'MILLISECOND', uncertaintyMs: 0 } };
  const { delivery, pipeline } = createPermittedReplayDelivery(pool,
    createFixtureCandidateDirectory(createFixtureFleet()), { ...scope, retentionAllowed: true,
      purpose: 'PRIVATE_PROCESSING', evidenceReference: 'repository-synthetic-fixtures-only' }, scope,
    raw => ({ ...scope, payloadDigest: createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
      ingestedAt: { at: new Date(now()).toISOString(), basis: 'INGESTED', precision: 'MILLISECOND', uncertaintyMs: 0 } }),
    () => ({ pageUrl: 'https://synthetic.invalid/replay', parserVersion: 'replay-contract-v1',
      retrievedAt: now(), ingestedAt: now() }), now);
  return {
    authorized: async r => r.mode === 'SYNTHETIC' && r.provider === 'synthetic'
      && r.sourceId === 'src_synthetic' && r.account === 'private-fixture',
    coverageKind: 'SAMPLED', now,
    delivery, pipeline,
    reader: { async read({ cursor, maxRecords, signal }) {
      signal.throwIfAborted();
      if (cursor !== null && cursor !== 'synthetic-overlap') return { ok: false, error: { code: 'CURSOR_EXPIRED' } };
      if (maxRecords < 1) return { ok: false, error: { code: 'BUDGET_EXHAUSTED' } };
      return { ok: true, value: { records: [record], bytes: Buffer.byteLength(JSON.stringify([record])),
        nextCursor: cursor === null ? 'synthetic-overlap' : null } };
    } },
  };
}
