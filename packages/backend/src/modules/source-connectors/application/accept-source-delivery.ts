import { epochMillis } from '../../../kernel/time/epoch-millis.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';
import { hasOnlyKeys, hasOwn, isToken, plainRecord } from '../domain/input-validation.ts';
import { parseSourceObservation } from '../domain/source-observation.ts';
import type { SourceCapabilities } from '../domain/source-capabilities.ts';
import type { SourceDeliveryIdentity } from '../domain/source-delivery-identity.ts';
import type { SourceId } from '../domain/source-id.ts';
import { sourcePageLocation } from '../domain/source-page-location.ts';
import type { DeliveryReceipt, SourceAcceptanceTransaction } from '../ports/source-acceptance-transaction.ts';
import type { SourceDeliveryOrigin } from '../ports/source-delivery-store.ts';

/** Configuration supplied by the operator, independently of incoming observations. */
export interface VerifiedSourceScope extends Omit<SourceDeliveryIdentity, 'externalId'> {
  readonly sourceId: SourceId;
  readonly capabilities: SourceCapabilities;
}

export type AcceptanceResult = Result<DeliveryReceipt & { readonly outcome: 'CREATED' | 'DUPLICATE' },
  | { readonly code: 'INVALID'; readonly field: 'observation' | 'origin' | 'sourceScope' | 'capabilities' }
  | { readonly code: 'CONFLICTED'; readonly deliveryId: string }
  | { readonly code: 'UNAVAILABLE' }>;

function parseOrigin(input: unknown): SourceDeliveryOrigin | null {
  const record = plainRecord(input);
  if (!record || !hasOnlyKeys(record, ['pageUrl', 'parserVersion', 'retrievedAt', 'ingestedAt'])
    || !isToken(record['parserVersion']) || typeof record['retrievedAt'] !== 'number'
    || typeof record['ingestedAt'] !== 'number') return null;
  const pageUrl = sourcePageLocation(record['pageUrl']);
  const retrieved = epochMillis(record['retrievedAt']), ingested = epochMillis(record['ingestedAt']);
  if (!pageUrl || !retrieved.ok || !ingested.ok || retrieved.value > ingested.value) return null;
  return { pageUrl, parserVersion: record['parserVersion'], retrievedAt: retrieved.value, ingestedAt: ingested.value };
}

/** A parsed #5 time carries both UTC text and milliseconds. Check their equivalence
 * before reusing the envelope parser for all clock and level invariants. */
function envelopeTime(value: unknown): unknown {
  const time = plainRecord(value);
  if (!time || !hasOwn(time, 'iso')) return value;
  if (!hasOnlyKeys(time, ['iso', 'at', 'basis', 'precision', 'uncertaintyMs'])
    || typeof time['at'] !== 'number' || typeof time['iso'] !== 'string'
    || Date.parse(time['iso']) !== time['at']) return null;
  return { at: time['iso'], basis: time['basis'], precision: time['precision'], uncertaintyMs: time['uncertaintyMs'] };
}

function parseAcceptanceObservation(input: unknown) {
  const record = plainRecord(input);
  if (record) {
    for (const field of ['receivedAt', 'observedAt']) {
      if (hasOwn(record, field)) record[field] = envelopeTime(record[field]);
    }
  }
  return parseSourceObservation(record);
}

export async function acceptSourceDelivery(scope: VerifiedSourceScope, transaction: SourceAcceptanceTransaction,
  envelope: unknown, provenance: unknown): Promise<AcceptanceResult> {
  const parsed = parseAcceptanceObservation(envelope);
  if (!parsed.ok) return err({ code: 'INVALID', field: 'observation' });
  const observation = parsed.value;
  const { provider, accountScope, sourceEpoch } = observation.sourceDeliveryId;
  if (observation.sourceId !== scope.sourceId || provider !== scope.provider
    || accountScope !== scope.accountScope || sourceEpoch !== scope.sourceEpoch)
    return err({ code: 'INVALID', field: 'sourceScope' });
  const cap = scope.capabilities;
  if (observation.capabilitiesRevision !== cap.revision || !cap.supportedDataLevels.includes(observation.dataLevel)
    || (observation.dataLevel === 'RECEPTION' && cap.coverage.kind === 'STATION_SCOPED'
      && cap.receiverCoverageCompleteness === 'COMPLETE' && !cap.coverage.receiverIds.includes(observation.receiverId)))
    return err({ code: 'INVALID', field: 'capabilities' });
  const origin = parseOrigin(provenance);
  if (!origin) return err({ code: 'INVALID', field: 'origin' });
  try {
    return await transaction.run<AcceptanceResult>(observation, origin, async locked => {
      const previous = await locked.readPrevious();
      if (!previous) return ok({ outcome: 'CREATED', ...await locked.append() });
      if (!previous.matches) return err({ code: 'CONFLICTED', deliveryId: previous.deliveryId });
      return ok({ outcome: 'DUPLICATE', deliveryId: previous.deliveryId, origin: previous.origin });
    });
  } catch {
    // An interrupted COMMIT may already be durable. Replay the same envelope and scoped key.
    return err({ code: 'UNAVAILABLE' });
  }
}
