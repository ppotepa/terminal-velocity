import { createHash } from 'node:crypto';
import type { SourceObservation } from '../../domain/source-observation.ts';
/** V1 hashes UTF-8 JSON with sorted object keys; protocol-layer array order is significant. */
export function fingerprint(observation: SourceObservation, parserVersion: string): string {
  const json = JSON.stringify([parserVersion, observation], (_key, value: unknown) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  });
  return createHash('sha256').update('source-acceptance-v1\0').update(json, 'utf8').digest('hex');
}


/** Includes normalized registration and all provenance, not just legacy observation hints. */
export function normalizedFingerprint(value: unknown): string {
  const json = JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  });
  return createHash('sha256').update('normalized-source-v1\0').update(json).digest('hex');
}

export function normalizedFactsFingerprint(canonical: import('../../domain/normalized-observation.ts').CanonicalSourceObservation): string {
  const { ingestedAt: _ingested, retrievedAt: _retrieved, ...provenance } = canonical.provenance;
  return normalizedFingerprint({ ...canonical, provenance });
}

/** Delivery transport identity and its envelope hash are not a provider message occurrence. */
export function providerFactsFingerprint(canonical: import('../../domain/normalized-observation.ts').CanonicalSourceObservation): string {
  const { ingestedAt: _ingested, retrievedAt: _retrieved, deliveryId: _delivery, ...provenance } = canonical.provenance;
  const { payloadDigest: _digest, sourceDeliveryId, ...observation } = canonical.observation;
  const { externalId: _external, ...scope } = sourceDeliveryId;
  return normalizedFingerprint({ ...canonical, observation: { ...observation, sourceDeliveryId: scope }, provenance });
}
