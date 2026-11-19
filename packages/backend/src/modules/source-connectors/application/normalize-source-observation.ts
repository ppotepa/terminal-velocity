import { epochMillis } from '../../../kernel/time/epoch-millis.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';
import { decodePayload, EXTRACTED_RECORD_VERSION } from '../domain/decode-source-record.ts';
import { hasOnlyKeys, hasOwn, isOpaqueText, isToken, plainRecord } from '../domain/input-validation.ts';
import { observationTimeEvidence, type ObservationTimeEvidence } from '../domain/time-evidence.ts';
import { sourceCapabilities } from '../domain/source-capabilities.ts';
import { parseSourceObservation } from '../domain/source-observation.ts';
import type { AircraftHints, CanonicalSourceObservation, NormalizationError } from '../domain/normalized-observation.ts';
import { normalizeAircraftHints } from './normalize-aircraft-hints.ts';

export interface NormalizationContext {
  readonly sourceId: string;
  readonly provider: string;
  readonly accountScope: string;
  readonly sourceEpoch: string;
  readonly payloadDigest: string;
  /** Trusted caller clock, never a fallback for source time. */
  readonly ingestedAt: unknown;
  readonly retrievedAt?: number;
}

export function normalizeSourceObservation(input: unknown, context: NormalizationContext,
  capability: unknown): Result<CanonicalSourceObservation, NormalizationError> {
  const fail = (code: NormalizationError['code'], field: string): Result<never, NormalizationError> =>
    err({ code, field, schemaVersion: EXTRACTED_RECORD_VERSION });
  const decoded = decodePayload(input);
  if (!decoded.ok) return decoded;
  const row = decoded.value;
  const cap = sourceCapabilities(capability);
  if (!cap.ok) return fail('CAPABILITY_MISMATCH', 'capability');
  for (const field of ['originalSourceId', 'deliveryId', 'sourceDescription']) {
    if (!isOpaqueText(row[field], field === 'sourceDescription' ? 512 : 256)) return fail('INVALID_INPUT', field);
  }
  const decoder = plainRecord(row['decoder']);
  if (!decoder || !hasOnlyKeys(decoder, ['name', 'version'])
    || !isToken(decoder['name']) || !isToken(decoder['version'])) return fail('INVALID_INPUT', 'decoder');
  const times: { sourceObservedAt?: ObservationTimeEvidence; receiverReceivedAt?: ObservationTimeEvidence;
    providerPublishedAt?: ObservationTimeEvidence } = {};
  for (const field of ['sourceObservedAt', 'receiverReceivedAt', 'providerPublishedAt'] as const) {
    if (!hasOwn(row, field)) continue;
    const parsed = observationTimeEvidence(row[field]);
    const basis = field === 'sourceObservedAt' ? 'OBSERVED' : field === 'receiverReceivedAt' ? 'RECEIVED' : 'PROVIDER';
    if (!parsed.ok || parsed.value.basis !== basis) return fail('UNTRUSTED_TIME', field);
    times[field] = parsed.value;
  }
  const ingested = observationTimeEvidence(context.ingestedAt);
  if (!ingested.ok || ingested.value.basis !== 'INGESTED') return fail('UNTRUSTED_TIME', 'ingestedAt');
  const retrieved = context.retrievedAt === undefined ? undefined : epochMillis(context.retrievedAt);
  if (retrieved && (!retrieved.ok || retrieved.value > ingested.value.at)) return fail('UNTRUSTED_TIME', 'retrievedAt');
  const received = times.receiverReceivedAt ?? times.providerPublishedAt;
  if (!received) return fail('UNTRUSTED_TIME', 'receivedAt');
  for (const [field, time] of Object.entries(times)) {
    if (time.at - time.uncertaintyMs > ingested.value.at + ingested.value.uncertaintyMs)
      return fail('UNTRUSTED_TIME', field);
  }
  if (times.receiverReceivedAt && times.providerPublishedAt
    && times.receiverReceivedAt.at - times.receiverReceivedAt.uncertaintyMs
      > times.providerPublishedAt.at + times.providerPublishedAt.uncertaintyMs)
    return fail('UNTRUSTED_TIME', 'providerPublishedAt');
  if (times.sourceObservedAt && times.providerPublishedAt
    && times.sourceObservedAt.at - times.sourceObservedAt.uncertaintyMs
      > times.providerPublishedAt.at + times.providerPublishedAt.uncertaintyMs)
    return fail('UNTRUSTED_TIME', 'providerPublishedAt');
  const hints: Record<string, AircraftHints> = {};
  const originalRegistrations: Partial<Record<'aircraft' | 'originator' | 'addressee', string>> = {};
  for (const field of ['aircraft', 'originator', 'addressee'] as const) {
    if (!hasOwn(row, field)) continue;
    const parsed = normalizeAircraftHints(row[field]);
    if (!parsed.ok) return fail('INVALID_INPUT', field);
    hints[field] = parsed.value;
    const original = plainRecord(row[field])?.['registration'];
    if (typeof original === 'string') originalRegistrations[field] = original;
  }
  const direction = row['direction'];
  if (hasOwn(row, 'direction') && (typeof direction !== 'string'
    || !['UPLINK', 'DOWNLINK', 'UNKNOWN', 'BIDIRECTIONAL'].includes(direction)))
    return fail('INVALID_INPUT', 'direction');
  const role = direction === 'UPLINK' ? 'ADDRESSEE' : direction === 'DOWNLINK' ? 'ORIGINATOR' : 'UNKNOWN';
  // Participant hints in this schema describe aircraft only, never ground addresses.
  if ((hints['originator'] && role !== 'ORIGINATOR') || (hints['addressee'] && role !== 'ADDRESSEE'))
    return fail('CONFLICTING_HINTS', 'participants');
  const aircraft: { icao24?: string; registration?: string; callsign?: string } = {};
  for (const value of Object.values(hints)) for (const key of ['icao24', 'registration', 'callsign'] as const) {
    if (value[key] === undefined) continue;
    if (aircraft[key] !== undefined && aircraft[key] !== value[key]) return fail('CONFLICTING_HINTS', key);
    aircraft[key] = value[key];
  }
  for (const field of ['bearer', 'applicationProtocol']) {
    if (hasOwn(row, field) && !isToken(row[field])) return fail('INVALID_INPUT', field);
  }
  if (hasOwn(row, 'feeder') && !isOpaqueText(row['feeder'], 256)) return fail('INVALID_INPUT', 'feeder');
  const bearer = typeof row['bearer'] === 'string'
    ? (['VHF_ACARS', 'VDL2', 'HFDL', 'SATCOM'].includes(row['bearer']) ? row['bearer'] : 'UNKNOWN') : undefined;
  const protocol = typeof row['applicationProtocol'] === 'string'
    ? (['ACARS', 'ATN', 'CPDLC', 'ADS_C'].includes(row['applicationProtocol']) ? row['applicationProtocol'] : 'UNKNOWN') : undefined;
  const level = row['dataLevel'];
  if (typeof level !== 'string' || !['PROVIDER_MESSAGE', 'RECEPTION', 'FRAME'].includes(level)) return fail('UNSUPPORTED_LEVEL', 'dataLevel');
  if (!cap.value.supportedDataLevels.some(item => item === level)) return fail('CAPABILITY_MISMATCH', 'dataLevel');
  const levelFields = level === 'PROVIDER_MESSAGE' ? ['text'] : level === 'RECEPTION'
    ? ['receiverId', 'frequencyHz', 'signalStrengthDbm'] : ['frameBytesBase64', 'frequencyHz'];
  for (const field of ['text', 'receiverId', 'frequencyHz', 'signalStrengthDbm', 'frameBytesBase64']) {
    if (hasOwn(row, field) && !levelFields.includes(field)) return fail('INVALID_INPUT', field);
  }
  const wireTime = (time: ObservationTimeEvidence) => ({ at: time.iso, basis: time.basis,
    precision: time.precision, uncertaintyMs: time.uncertaintyMs });
  const fields: Record<string, unknown> = {};
  for (const field of levelFields) if (hasOwn(row, field)) fields[field === 'text' ? 'decodedText' : field] = row[field];
  const parsed = parseSourceObservation({ schemaVersion: 1, dataLevel: level, sourceId: context.sourceId,
    sourceDeliveryId: { provider: context.provider, accountScope: context.accountScope,
      sourceEpoch: context.sourceEpoch, externalId: row['deliveryId'] },
    capabilitiesRevision: cap.value.revision, payloadDigest: context.payloadDigest,
    decoderVersion: decoder['version'], receivedAt: wireTime(received),
    ...(times.sourceObservedAt ? { observedAt: wireTime(times.sourceObservedAt) } : {}), ...fields,
    ...(level === 'RECEPTION' ? {} : {
      ...(bearer === undefined ? {} : { bearer }), ...(protocol === undefined ? {} : { protocolStack: [protocol] }),
      ...(direction === undefined ? {} : { direction }),
    }),
    ...(level === 'PROVIDER_MESSAGE' && (aircraft.icao24 || aircraft.callsign) ? {
      addressHints: { ...(aircraft.icao24 ? { icao24: aircraft.icao24 } : {}),
        ...(aircraft.callsign ? { callsign: aircraft.callsign } : {}) },
    } : {}),
  });
  if (!parsed.ok) return fail(parsed.error.code === 'FUTURE_OBSERVATION' ? 'UNTRUSTED_TIME' : 'INVALID_INPUT',
    'field' in parsed.error ? parsed.error.field : 'observation');
  if (parsed.value.dataLevel === 'RECEPTION' && cap.value.coverage.kind === 'STATION_SCOPED'
    && cap.value.receiverCoverageCompleteness === 'COMPLETE'
    && !cap.value.coverage.receiverIds.includes(parsed.value.receiverId)) return fail('CAPABILITY_MISMATCH', 'receiverId');
  return ok(Object.freeze({ schemaVersion: 1, observation: parsed.value,
    aircraftHints: Object.freeze(aircraft), aircraftRole: role,
    ...(bearer === undefined ? {} : { bearer }),
    ...(protocol === undefined ? {} : { applicationProtocol: protocol }),
    ...(typeof direction === 'string' ? { direction } : {}),
    provenance: Object.freeze({ originalSourceId: row['originalSourceId'] as string,
      originalRegistrations: Object.freeze(originalRegistrations),
      deliveryId: row['deliveryId'] as string, sourceDescription: row['sourceDescription'] as string,
      decoder: Object.freeze({ name: decoder['name'], version: decoder['version'] }), ...times,
      ingestedAt: ingested.value, ...(retrieved?.ok ? { retrievedAt: retrieved.value } : {}),
      ...(typeof row['feeder'] === 'string' ? { feeder: row['feeder'] } : {}),
      ...(typeof row['bearer'] === 'string' ? { bearerLabel: row['bearer'] } : {}),
      ...(typeof row['applicationProtocol'] === 'string' ? { applicationProtocolLabel: row['applicationProtocol'] } : {}),
    }),
  }));
}
