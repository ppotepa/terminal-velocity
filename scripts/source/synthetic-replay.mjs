import { createHash } from 'node:crypto';
import { createObservationReplayDelivery } from '../../packages/backend/src/modules/source-connectors/composition/create-observation-replay-delivery.ts';
import { sourceCapabilities } from '../../packages/backend/src/modules/source-connectors/public/index.ts';
import { postgresSourceAcceptanceTransaction } from '../../packages/backend/src/modules/source-connectors/infrastructure/postgres/postgres-source-acceptance-transaction.ts';

/** Fixed synthetic contract fixture; never selected by the user-facing messages crawl. */
export function syntheticReplay(pool, request, now = Date.now) {
  const scope = { sourceId: request.sourceId, provider: request.provider, accountScope: request.account,
    sourceEpoch: request.sourceEpoch, capabilities: sourceCapabilities({ revision: 1,
      supportedDataLevels: ['PROVIDER_MESSAGE'], coverage: { kind: 'UNKNOWN' },
      receiverCoverageCompleteness: 'UNKNOWN', sampling: { kind: 'NOT_DECLARED' },
      messageDirection: 'UNKNOWN', bearer: null, protocolStack: [] }).value };
  const observed = request.from;
  const record = { schemaVersion: 1, dataLevel: 'PROVIDER_MESSAGE', sourceId: request.sourceId,
    sourceDeliveryId: { provider: request.provider, accountScope: request.account,
      sourceEpoch: request.sourceEpoch, externalId: `fixture-${observed}` },
    payloadDigest: createHash('sha256').update(`synthetic replay ${observed}`).digest('hex'),
    capabilitiesRevision: 1, decodedText: 'Synthetic replay fixture',
    receivedAt: { at: new Date(observed).toISOString(), basis: 'RECEIVED', precision: 'MILLISECOND', uncertaintyMs: 0 },
    observedAt: { at: new Date(observed).toISOString(), basis: 'OBSERVED', precision: 'MILLISECOND', uncertaintyMs: 0 } };
  return {
    authorized: async r => r.mode === 'SYNTHETIC' && r.provider === 'synthetic'
      && r.sourceId === 'src_synthetic' && r.account === 'private-fixture',
    coverageKind: 'SAMPLED', now,
    delivery: createObservationReplayDelivery(scope, postgresSourceAcceptanceTransaction(pool), () => ({
      pageUrl: 'https://synthetic.invalid/replay', parserVersion: 'replay-contract-v1', retrievedAt: now(), ingestedAt: now(),
    })),
    reader: { async read({ cursor, maxRecords, signal }) {
      signal.throwIfAborted();
      if (cursor !== null && cursor !== 'synthetic-overlap') return { ok: false, error: { code: 'CURSOR_EXPIRED' } };
      if (maxRecords < 1) return { ok: false, error: { code: 'BUDGET_EXHAUSTED' } };
      return { ok: true, value: { records: [record], bytes: Buffer.byteLength(JSON.stringify([record])),
        nextCursor: cursor === null ? 'synthetic-overlap' : null } };
    } },
  };
}
