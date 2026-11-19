import type { SourceDeliveryEnvelope } from '../../ports/source-transport.ts';

export const pageUrl = 'https://app.airframes.io/messages/live';
export const maxCards = 25;
export const maxEnvelopeBytes = 32 * 1024;
export const maxWindowBytes = 128 * 1024;

export interface RenderedCard {
  readonly icao: string;
  readonly messagePath: string;
  readonly text: string;
  readonly station: string | null;
}

export type PageDelivery = SourceDeliveryEnvelope<RenderedCard>;

export type PageResponse = { status: number; retryAfter?: string; stopAfterResponse?: boolean; body?: unknown };
export type ReadWindow = (icao: string, signal: AbortSignal) => Promise<PageResponse>;

export function validateWindow(body: unknown, icao: string, retrievedAt: number, allowPartialPreview = false) {
  if (!body || typeof body !== 'object' || !('messages' in body) || !Array.isArray(body.messages)
    || !('status' in body) || !('source' in body) || body.source !== pageUrl
    || !('icao' in body) || body.icao !== icao) return 'INVALID_ENVELOPE';
  if (body.status === 'QUEUE_FULL' || body.messages.length > maxCards
    || (body.status === 'TRUNCATED' && !allowPartialPreview)) return 'QUEUE_FULL';
  if (body.status !== (body.messages.length ? 'OBSERVED' : 'NO_CONFIRMED_MATCH')
    && !(allowPartialPreview && (body.status === 'PARTIAL_LAYOUT' || body.status === 'TRUNCATED'))
    && !(body.messages.length === 0 && body.status === 'NO_OBSERVATIONS_COVERAGE_UNKNOWN')) return 'INVALID_ENVELOPE';
  let bytes = 0;
  const deliveries: PageDelivery[] = [];
  for (const row of body.messages) {
    if (!row || row.icao !== icao || typeof row.messagePath !== 'string' || row.messagePath.length > 256
      || !/^\/messages\/(?!live\/?$|ar\/?$|history\/?$|search\/?$)[\w-]+\/?$/.test(row.messagePath)
      || typeof row.text !== 'string' || !row.text || row.text.length > maxEnvelopeBytes
      || !(row.station === null || (typeof row.station === 'string' && row.station.length <= 256))) return 'INVALID_ENVELOPE';
    const card = { icao, messagePath: row.messagePath, text: row.text, station: row.station };
    const delivery: PageDelivery = { source: pageUrl, raw: card, retrievedAt };
    const size = Buffer.byteLength(JSON.stringify(delivery));
    if (size > maxEnvelopeBytes) return 'INVALID_ENVELOPE';
    bytes += size;
    if (bytes > maxWindowBytes) return 'QUEUE_FULL';
    deliveries.push(delivery);
  }
  return deliveries;
}

export function retryAfterMs(header: string | undefined, now: number) {
  if (!header) return 0;
  if (/^\d+$/.test(header.trim())) return Number(header) * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}
