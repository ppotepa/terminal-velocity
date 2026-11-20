import type { MessageId } from '../../../contracts/identity/index.ts';
import { epochMillis } from '../../../kernel/time/epoch-millis.ts';
import { createCorrelateMessage, icao24, registration, type CandidateDirectory,
  type EventIdGenerator, type StrongIdentifier } from '../../aircraft-correlation/public/index.ts';
import type { CanonicalSourceObservation } from '../domain/normalized-observation.ts';
import type { ProviderMessageCommit, ProviderImportResult, ImportQuarantine } from '../ports/provider-message-commit.ts';

/** Called inside the source consumer transaction, never against an unrelated pool. */
export async function importProviderMessage(input: { readonly messageId: MessageId; readonly sourceDeliveryId: string;
  readonly canonical: CanonicalSourceObservation | null; readonly now: number },
  writes: ProviderMessageCommit, directory: CandidateDirectory, eventIds: EventIdGenerator): Promise<ProviderImportResult> {
  const { canonical, messageId, sourceDeliveryId } = input;
  const quarantine = async (reason: ImportQuarantine) => {
    await writes.quarantine(reason);
    return { outcome: 'QUARANTINED' as const, sourceDeliveryId, reason };
  };
  if (!canonical) return quarantine('RETENTION_NOT_PERMITTED');
  const observation = canonical.observation;
  if (observation.dataLevel !== 'PROVIDER_MESSAGE') return quarantine('UNSUPPORTED_LEVEL');
  if (!observation.observedAt) return quarantine('MISSING_OBSERVATION_TIME');
  const time = epochMillis(input.now);
  if (!time.ok) throw new Error('Invalid import clock.');
  if (observation.observedAt.at > time.value) return quarantine('INVALID_CANONICAL');
  const identifiers: StrongIdentifier[] = [];
  const hints = canonical.aircraftHints;
  if (hints.icao24 !== undefined) {
    const parsed = icao24(hints.icao24);
    if (!parsed.ok) return quarantine('INVALID_CANONICAL');
    identifiers.push({ kind: 'ICAO24', value: parsed.value });
  }
  if (hints.registration !== undefined) {
    const parsed = registration(hints.registration);
    if (!parsed.ok) return quarantine('INVALID_CANONICAL');
    identifiers.push({ kind: 'REGISTRATION', value: parsed.value });
  }
  const common = { messageId, messageRevision: 1 as const, sourceDeliveryId, observedAt: observation.observedAt.at };
  const previous = await writes.read();
  if (previous) {
    if (!previous.sameFacts) return quarantine('IDENTITY_CONFLICT');
    await writes.link(previous.decision);
    return { ...common, outcome: 'DUPLICATE', decision: previous.decision };
  }
  const correlate = createCorrelateMessage({ directory, transaction: writes.decisions,
    clock: { now: () => time.value }, eventIds });
  await writes.insert(canonical);
  const decision = await correlate({ messageId, effectiveAt: observation.observedAt.at,
    identifiers, callsign: hints.callsign ?? null }, null);
  // Any failure must roll back the enclosing inbox and inserted facts as well.
  if (!decision.ok) throw new Error(decision.error.code);
  await writes.link(decision.value);
  return { ...common, outcome: decision.value.decision.status === 'MATCHED' ? 'IMPORTED' : decision.value.decision.status,
    decision: decision.value };
}
