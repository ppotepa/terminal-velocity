import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { evidenceDigest } from '../../../src/modules/source-connectors/infrastructure/airframes/decode-payload.ts';
export const NOW = Date.parse('2026-11-19T10:01:00Z');
export const scope = { sourceId: 'src_synthetic', provider: 'synthetic', accountScope: 'private-fixture', sourceEpoch: 'v1',
  capabilities: { revision: 1, supportedDataLevels: ['PROVIDER_MESSAGE','RECEPTION','FRAME'],
    coverage: { kind: 'UNKNOWN' }, receiverCoverageCompleteness: 'UNKNOWN', sampling: { kind: 'NOT_DECLARED' },
    messageDirection: 'UNKNOWN', bearer: null, protocolStack: [] } };
export const origin = { pageUrl: 'https://synthetic.example/messages/page', parserVersion: 'fixture-v1',
  retrievedAt: NOW - 100, ingestedAt: NOW };
export function fixture() {
  const raw = JSON.parse(readFileSync(new URL('../../fixtures/airframes/valid/message.json', import.meta.url)));
  raw.deliveryId = 'synthetic-' + randomUUID();
  raw.originalSourceId = raw.deliveryId;
  raw.aircraft = { icao24: 'D00001', registration: 'DEMO-001' };
  delete raw.originator;
  return raw;
}
export function context(raw) {
  return { ...scope, payloadDigest: evidenceDigest(raw),
    ingestedAt: { at: new Date(NOW).toISOString(), basis: 'INGESTED', precision: 'SECOND', uncertaintyMs: 0 } };
}
export function accept(pipeline, raw = fixture(), provenance = origin) {
  return pipeline.acceptFixture(raw, context(raw), scope, provenance);
}
