import { err, ok, type Result } from '../../../kernel/result.ts';
import { latitudeDegrees, longitudeDegrees, type LatitudeDegrees, type LongitudeDegrees } from './geo-coordinate.ts';
import {
  positionSourceId, sourceObservationId, type PositionSourceId, type SourceObservationId,
} from './position-identifiers.ts';
import {
  groundSpeedKnots, measurementDetail, positionAltitude, positionMeasurementKind, positionTrackKind, trackDegrees,
  type PositionAltitude, type PositionMeasurementKind, type PositionTrackKind,
} from './position-measurement.ts';
import {
  positionObservedAtBasis, positionTimePrecision, sourceAgeSeconds, timestampUncertainty, utcTimestamp,
  type PositionObservedAtBasis, type PositionTimePrecision, type UtcTimestamp,
} from './position-time.ts';
import { positionQuality, type PositionQuality } from './position-quality.ts';

export const POSITION_OBSERVATION_SCHEMA_VERSION = 1 as const;

export interface PositionIdentifierHints {
  /** Six hexadecimal characters. This is a hint, not a confirmed temporal identity link. */
  readonly icao24?: string;
  /** Callsigns can be reused and are not treated as stable aircraft identities. */
  readonly callsign?: string;
  /** An identifier scoped to this source; it is not globally stable. */
  readonly sourceLocalId?: string;
}

export interface PositionObservation {
  readonly schemaVersion: typeof POSITION_OBSERVATION_SCHEMA_VERSION;
  readonly sourceId: PositionSourceId;
  readonly sourceObservationId: SourceObservationId;
  readonly observedAt: UtcTimestamp;
  readonly observedAtBasis: PositionObservedAtBasis;
  /** Present together only when observedAt was derived from a source-declared age. */
  readonly sourceTimeReferenceAt?: UtcTimestamp;
  readonly sourceAgeSeconds?: number;
  readonly ingestedAt: UtcTimestamp;
  readonly timestampPrecision: PositionTimePrecision;
  /** Null means the source's clock uncertainty is unknown; zero is an explicit claim of no uncertainty. */
  readonly timestampUncertaintyMs: number | null;
  readonly measurementKind: PositionMeasurementKind;
  readonly latitude: LatitudeDegrees;
  readonly longitude: LongitudeDegrees;
  readonly identifierHints?: PositionIdentifierHints;
  readonly quality?: PositionQuality;
  /** Absent means the provider omitted the field; null means it explicitly reported it unavailable. */
  readonly groundSpeedKnots?: number | null;
  readonly trackDegrees?: number | null;
  /** Required with a numeric track so on-ground true heading is not mislabeled as airborne track. */
  readonly trackKind?: PositionTrackKind;
  /** Feet are explicit and barometric/geometric values remain separate. */
  readonly altitude?: PositionAltitude | null;
  readonly measurementDetail?: string;
}

export type PositionParseError =
  | { readonly code: 'INVALID_INPUT'; readonly field: string }
  | { readonly code: 'UNSUPPORTED_VERSION'; readonly version: number }
  | { readonly code: 'INVALID_POSITION_TIME'; readonly field: 'observedAt' | 'ingestedAt' | 'precision' | 'uncertaintyMs' | 'observedAtBasis' | 'sourceAgeSeconds' }
  | { readonly code: 'OBSERVATION_AFTER_INGESTION' }
  | { readonly code: 'INVALID_COORDINATE'; readonly field: 'latitude' | 'longitude' }
  | { readonly code: 'INVALID_POSITION_MEASUREMENT'; readonly field: 'measurementKind' | 'measurementDetail' | 'altitude' | 'groundSpeedKnots' | 'trackDegrees' | 'trackKind' }
  | { readonly code: 'INVALID_POSITION_IDENTIFIER'; readonly field: 'sourceId' | 'sourceObservationId' }
  | { readonly code: 'INVALID_IDENTIFIER_HINTS' }
  | { readonly code: 'INVALID_POSITION_QUALITY'; readonly field: 'quality' | 'nic' | 'nacP' | 'containmentRadiusMeters' };

type PlainRecord = Record<string, unknown>;

function plainRecord(input: unknown): PlainRecord | null {
  try {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const output: PlainRecord = Object.create(null) as PlainRecord;
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== 'string') return null;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !('value' in descriptor)) return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    return null;
  }
}

function hasOnlyKeys(record: PlainRecord, allowed: readonly string[]): boolean {
  const keySet = new Set(allowed);
  return Object.keys(record).every(key => keySet.has(key));
}

function parseIdentifierHints(input: unknown): Result<PositionIdentifierHints, PositionParseError> {
  const record = plainRecord(input);
  if (!record || !hasOnlyKeys(record, ['icao24', 'callsign', 'sourceLocalId']) || Object.keys(record).length === 0)
    return err({ code: 'INVALID_IDENTIFIER_HINTS' });
  const output: { icao24?: string; callsign?: string; sourceLocalId?: string } = {};
  if (Object.hasOwn(record, 'icao24')) {
    const icao24 = record['icao24'];
    if (typeof icao24 !== 'string' || !/^[0-9a-fA-F]{6}$/u.test(icao24))
      return err({ code: 'INVALID_IDENTIFIER_HINTS' });
    output.icao24 = icao24.toUpperCase();
  }
  for (const field of ['callsign', 'sourceLocalId'] as const) {
    if (!Object.hasOwn(record, field)) continue;
    const value = record[field];
    if (typeof value !== 'string' || value.length === 0 || value.length > 128
      || value !== value.trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(value))
      return err({ code: 'INVALID_IDENTIFIER_HINTS' });
    output[field] = value;
  }
  return ok(Object.freeze(output));
}

/** Validates an already normalized v1 observation; this does not parse any provider's wire format. */
export function parsePositionObservation(input: unknown): Result<PositionObservation, PositionParseError> {
  const record = plainRecord(input);
  if (!record) return err({ code: 'INVALID_INPUT', field: 'object' });
  const allowed = [
    'schemaVersion', 'sourceId', 'sourceObservationId', 'observedAt', 'observedAtBasis',
    'sourceTimeReferenceAt', 'sourceAgeSeconds', 'ingestedAt', 'timestampPrecision',
    'timestampUncertaintyMs', 'measurementKind', 'latitude', 'longitude', 'identifierHints', 'quality',
    'groundSpeedKnots', 'trackDegrees', 'trackKind', 'altitude', 'measurementDetail',
  ];
  if (!hasOnlyKeys(record, allowed)) return err({ code: 'INVALID_INPUT', field: 'unknown' });

  const schemaVersion = record['schemaVersion'];
  if (typeof schemaVersion !== 'number') return err({ code: 'INVALID_INPUT', field: 'schemaVersion' });
  if (schemaVersion !== POSITION_OBSERVATION_SCHEMA_VERSION)
    return err({ code: 'UNSUPPORTED_VERSION', version: schemaVersion });

  if (typeof record['sourceId'] !== 'string' || typeof record['sourceObservationId'] !== 'string')
    return err({ code: 'INVALID_INPUT', field: 'sourceIdentity' });
  const sourceId = positionSourceId(record['sourceId']);
  if (!sourceId.ok) return sourceId;
  const observationId = sourceObservationId(record['sourceObservationId']);
  if (!observationId.ok) return observationId;

  const observedAt = utcTimestamp(record['observedAt'], 'observedAt');
  if (!observedAt.ok) return observedAt;
  const observedAtBasis = positionObservedAtBasis(record['observedAtBasis']);
  if (!observedAtBasis.ok) return observedAtBasis;
  let sourceTimeReferenceAt: UtcTimestamp | undefined;
  let sourceAgeSecondsValue: number | undefined;
  if (Object.hasOwn(record, 'sourceTimeReferenceAt')) {
    const reference = utcTimestamp(record['sourceTimeReferenceAt'], 'observedAt');
    if (!reference.ok) return reference;
    sourceTimeReferenceAt = reference.value;
  }
  if (Object.hasOwn(record, 'sourceAgeSeconds')) {
    const age = sourceAgeSeconds(record['sourceAgeSeconds']);
    if (!age.ok) return age;
    sourceAgeSecondsValue = age.value;
  }
  if (observedAtBasis.value === 'SOURCE_AGE_FROM_REFERENCE') {
    if (sourceTimeReferenceAt === undefined || sourceAgeSecondsValue === undefined
      || Date.parse(observedAt.value) !== Math.round(Date.parse(sourceTimeReferenceAt) - sourceAgeSecondsValue * 1000))
      return err({ code: 'INVALID_POSITION_TIME', field: 'observedAtBasis' });
  } else if (sourceTimeReferenceAt !== undefined || sourceAgeSecondsValue !== undefined) {
    return err({ code: 'INVALID_POSITION_TIME', field: 'observedAtBasis' });
  }
  const ingestedAt = utcTimestamp(record['ingestedAt'], 'ingestedAt');
  if (!ingestedAt.ok) return ingestedAt;
  const precision = positionTimePrecision(record['timestampPrecision']);
  if (!precision.ok) return precision;
  const uncertainty = timestampUncertainty(record['timestampUncertaintyMs']);
  if (!uncertainty.ok) return uncertainty;
  const observedMillis = Date.parse(observedAt.value);
  const ingestedMillis = Date.parse(ingestedAt.value);
  if (observedMillis > ingestedMillis + (uncertainty.value ?? 0))
    return err({ code: 'OBSERVATION_AFTER_INGESTION' });

  const measurementKind = positionMeasurementKind(record['measurementKind']);
  if (!measurementKind.ok) return measurementKind;
  const latitude = latitudeDegrees(record['latitude']);
  if (!latitude.ok) return latitude;
  const longitude = longitudeDegrees(record['longitude']);
  if (!longitude.ok) return longitude;

  const output: {
    schemaVersion: typeof POSITION_OBSERVATION_SCHEMA_VERSION;
    sourceId: PositionSourceId;
    sourceObservationId: SourceObservationId;
    observedAt: UtcTimestamp;
    observedAtBasis: PositionObservedAtBasis;
    sourceTimeReferenceAt?: UtcTimestamp;
    sourceAgeSeconds?: number;
    ingestedAt: UtcTimestamp;
    timestampPrecision: PositionTimePrecision;
    timestampUncertaintyMs: number | null;
    measurementKind: PositionMeasurementKind;
    latitude: LatitudeDegrees;
    longitude: LongitudeDegrees;
    identifierHints?: PositionIdentifierHints;
    quality?: PositionQuality;
    groundSpeedKnots?: number | null;
    trackDegrees?: number | null;
    trackKind?: PositionTrackKind;
    altitude?: PositionAltitude | null;
    measurementDetail?: string;
  } = {
    schemaVersion: POSITION_OBSERVATION_SCHEMA_VERSION,
    sourceId: sourceId.value,
    sourceObservationId: observationId.value,
    observedAt: observedAt.value,
    observedAtBasis: observedAtBasis.value,
    ingestedAt: ingestedAt.value,
    timestampPrecision: precision.value,
    timestampUncertaintyMs: uncertainty.value,
    measurementKind: measurementKind.value,
    latitude: latitude.value,
    longitude: longitude.value,
  };

  if (sourceTimeReferenceAt !== undefined) output.sourceTimeReferenceAt = sourceTimeReferenceAt;
  if (sourceAgeSecondsValue !== undefined) output.sourceAgeSeconds = sourceAgeSecondsValue;

  if (Object.hasOwn(record, 'identifierHints')) {
    const hints = parseIdentifierHints(record['identifierHints']);
    if (!hints.ok) return hints;
    output.identifierHints = hints.value;
  }
  if (Object.hasOwn(record, 'quality')) {
    const quality = positionQuality(record['quality']);
    if (!quality.ok) return quality;
    output.quality = quality.value;
  }
  if (Object.hasOwn(record, 'groundSpeedKnots')) {
    const speed = groundSpeedKnots(record['groundSpeedKnots']);
    if (!speed.ok) return speed;
    output.groundSpeedKnots = speed.value;
  }
  if (Object.hasOwn(record, 'trackDegrees')) {
    const track = trackDegrees(record['trackDegrees']);
    if (!track.ok) return track;
    output.trackDegrees = track.value;
  }
  if (Object.hasOwn(record, 'trackKind')) {
    const kind = positionTrackKind(record['trackKind']);
    if (!kind.ok) return kind;
    output.trackKind = kind.value;
  }
  if (typeof output.trackDegrees === 'number' && output.trackKind === undefined)
    return err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'trackKind' });
  if ((output.trackDegrees === undefined || output.trackDegrees === null) && output.trackKind !== undefined)
    return err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'trackKind' });
  if (Object.hasOwn(record, 'altitude')) {
    const altitude = positionAltitude(record['altitude']);
    if (!altitude.ok) return altitude;
    output.altitude = altitude.value;
  }
  if (Object.hasOwn(record, 'measurementDetail')) {
    const detail = measurementDetail(record['measurementDetail']);
    if (!detail.ok) return detail;
    output.measurementDetail = detail.value;
  }
  if (measurementKind.value === 'OTHER' && !output.measurementDetail)
    return err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'measurementDetail' });
  if (measurementKind.value !== 'OTHER' && output.measurementDetail !== undefined)
    return err({ code: 'INVALID_POSITION_MEASUREMENT', field: 'measurementDetail' });

  return ok(Object.freeze(output));
}
