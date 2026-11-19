import { normalizeSourceObservation, type NormalizationContext } from '../../application/normalize-source-observation.ts';
import { EXTRACTED_RECORD_VERSION } from '../../domain/decode-source-record.ts';
import { evidenceDigest } from './decode-payload.ts';
import { pageUrl, validateWindow, type PageDelivery } from './page-window.ts';
import { err } from '../../../../kernel/result.ts';

/** Private transient adapter; invoking this grants neither retention nor publication. */
export function normalizeRenderedDelivery(delivery: PageDelivery,
  context: Omit<NormalizationContext, 'payloadDigest'>, capability: unknown) {
  const checked = validateWindow({ status: 'OBSERVED', source: delivery.source,
    icao: delivery.raw.icao, messages: [delivery.raw] }, delivery.raw.icao, delivery.retrievedAt);
  if (typeof checked === 'string') return err({ code: 'INVALID_INPUT' as const, field: 'delivery',
    schemaVersion: EXTRACTED_RECORD_VERSION });
  const card = checked[0]!.raw;
  const evidence = card.evidence ?? {};
  const times: Record<string, unknown> = {};
  for (const [key, basis] of [['receiverReceivedAt', 'RECEIVED'], ['sourceObservedAt', 'OBSERVED'],
    ['providerPublishedAt', 'PROVIDER']]) {
    const at = evidence[key!];
    if (at !== undefined) times[key!] = { at, basis,
      precision: /\.\d{1,3}Z$/.test(at) ? 'MILLISECOND' : 'SECOND',
      uncertaintyMs: /^\d+$/.test(evidence['uncertaintyMs'] ?? '') ? Number(evidence['uncertaintyMs']) : undefined };
  }
  const raw = { schemaVersion: EXTRACTED_RECORD_VERSION,
    originalSourceId: card.messagePath, deliveryId: card.messagePath, sourceDescription: pageUrl,
    decoder: { name: 'airframes-rendered-extractor', version: '1' }, dataLevel: 'PROVIDER_MESSAGE',
    text: card.text, aircraft: { icao24: card.icao,
      ...(evidence['registration'] === undefined ? {} : { registration: evidence['registration'] }),
      ...(evidence['callsign'] === undefined ? {} : { callsign: evidence['callsign'] }) },
    ...times, ...(card.station === null ? {} : { feeder: card.station }),
    ...Object.fromEntries(['direction', 'bearer', 'applicationProtocol']
      .filter(key => evidence[key] !== undefined).map(key => [key, evidence[key]])),
  };
  return normalizeSourceObservation(raw, { ...context, retrievedAt: delivery.retrievedAt, payloadDigest: evidenceDigest(raw) }, capability);
}
