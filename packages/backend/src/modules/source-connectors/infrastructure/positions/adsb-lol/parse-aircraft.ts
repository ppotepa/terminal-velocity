import { err, type Result } from '../../../../../kernel/result.ts';
import {
  parsePositionObservation,
  type PositionAdapter, type PositionObservation, type PositionParseContext,
  type PositionParseError, type PositionSourceId,
} from '../../../../flight-tracking/public/index.ts';

export type AdsbLolAircraftContext = PositionParseContext & {
  readonly sourceId: PositionSourceId;
  readonly snapshotNowMs: number;
};

type RecordValue = Record<string, unknown>;

function plainRecord(input: unknown): RecordValue | null {
  try {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const output: RecordValue = Object.create(null) as RecordValue;
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

function copyOptionalNumber(
  input: RecordValue,
  sourceField: string,
): Result<number | null | undefined, PositionParseError> {
  if (!Object.hasOwn(input, sourceField)) return { ok: true, value: undefined };
  const value = input[sourceField];
  if (value === null) return { ok: true, value: null };
  return typeof value === 'number' && Number.isFinite(value)
    ? { ok: true, value }
    : err({ code: 'INVALID_INPUT', field: sourceField });
}

/** Maps one positioned readsb aircraft item into the canonical contract. */
export const adsbLolPositionAdapter: PositionAdapter<unknown, AdsbLolAircraftContext> = Object.freeze({
  parse(raw: unknown, context: AdsbLolAircraftContext): Result<PositionObservation, PositionParseError> {
    const record = plainRecord(raw);
    if (!record) return err({ code: 'INVALID_INPUT', field: 'aircraft' });
    const hex = record['hex'];
    const type = record['type'];
    const seenPosition = record['seen_pos'];
    const latitude = record['lat'];
    const longitude = record['lon'];
    if (typeof hex !== 'string' || hex.length === 0 || hex.length > 64)
      return err({ code: 'INVALID_INPUT', field: 'hex' });
    if (typeof type !== 'string' || type.length === 0 || type.length > 128 || type !== type.trim())
      return err({ code: 'INVALID_INPUT', field: 'type' });
    if (latitude === null || latitude === undefined || longitude === null || longitude === undefined)
      return err({ code: 'INVALID_INPUT', field: 'lat/lon' });
    if (typeof seenPosition !== 'number' || !Number.isFinite(seenPosition) || seenPosition < 0)
      return err({ code: 'INVALID_INPUT', field: 'seen_pos' });
    if (!Number.isSafeInteger(context.snapshotNowMs) || context.snapshotNowMs < 0)
      return err({ code: 'INVALID_INPUT', field: 'now' });
    const observedMillis = Math.round(context.snapshotNowMs - seenPosition * 1000);
    if (!Number.isSafeInteger(observedMillis) || observedMillis < 0)
      return err({ code: 'INVALID_POSITION_TIME', field: 'observedAt' });
    let referenceAt: string;
    let observedAt: string;
    try {
      referenceAt = new Date(context.snapshotNowMs).toISOString();
      observedAt = new Date(observedMillis).toISOString();
    } catch {
      return err({ code: 'INVALID_POSITION_TIME', field: 'observedAt' });
    }

    const measurementKind = type === 'mlat' ? 'MLAT' : type.startsWith('adsb_') ? 'ADS_B' : 'OTHER';
    const sourceLocalId = `adsb-lol:${hex}`;
    const identifierHints = /^[0-9a-fA-F]{6}$/u.test(hex)
      ? { icao24: hex }
      : { sourceLocalId };
    const flight = record['flight'];
    if (flight !== undefined && flight !== null && typeof flight !== 'string')
      return err({ code: 'INVALID_INPUT', field: 'flight' });
    const callsign = typeof flight === 'string' ? flight.trim() : '';
    if (callsign.length > 128) return err({ code: 'INVALID_INPUT', field: 'flight' });

    const speed = copyOptionalNumber(record, 'gs');
    if (!speed.ok) return speed;
    const track = copyOptionalNumber(record, 'track');
    if (!track.ok) return track;
    const barometric = record['alt_baro'];
    const geometric = record['alt_geom'];
    if (barometric !== undefined && barometric !== null && barometric !== 'ground'
      && (typeof barometric !== 'number' || !Number.isFinite(barometric)))
      return err({ code: 'INVALID_INPUT', field: 'alt_baro' });
    if (geometric !== undefined && geometric !== null
      && (typeof geometric !== 'number' || !Number.isFinite(geometric)))
      return err({ code: 'INVALID_INPUT', field: 'alt_geom' });
    const altitude = barometric === 'ground'
      ? { kind: 'SURFACE', valueFt: null }
      : typeof barometric === 'number'
        ? { kind: 'BAROMETRIC_FT', valueFt: barometric }
        : typeof geometric === 'number'
          ? { kind: 'GEOMETRIC_FT', valueFt: geometric }
          : Object.hasOwn(record, 'alt_baro') || Object.hasOwn(record, 'alt_geom') ? null : undefined;

    const quality: Record<string, unknown> = {};
    if (Object.hasOwn(record, 'nic')) quality['nic'] = record['nic'];
    if (Object.hasOwn(record, 'nac_p')) quality['nacP'] = record['nac_p'];
    if (Object.hasOwn(record, 'rc')) quality['containmentRadiusMeters'] = record['rc'];

    const observation = {
      schemaVersion: 1,
      sourceId: context.sourceId,
      sourceObservationId: `adsb-lol:v2:${context.snapshotNowMs}:${hex}`,
      observedAt,
      observedAtBasis: 'SOURCE_AGE_FROM_REFERENCE',
      sourceTimeReferenceAt: referenceAt,
      sourceAgeSeconds: seenPosition,
      ingestedAt: context.ingestedAt,
      timestampPrecision: 'UNKNOWN',
      timestampUncertaintyMs: null,
      measurementKind,
      latitude,
      longitude,
      identifierHints: {
        ...identifierHints,
        ...(callsign.length === 0 ? {} : { callsign }),
      },
      ...(speed.value === undefined ? {} : { groundSpeedKnots: speed.value }),
      ...(track.value === undefined ? {} : { trackDegrees: track.value,
        ...(track.value === null ? {} : { trackKind: barometric === 'ground' ? 'TRUE_HEADING' : 'GROUND_TRACK' }) }),
      ...(altitude === undefined ? {} : { altitude }),
      ...(Object.keys(quality).length === 0 ? {} : { quality }),
      ...(measurementKind === 'OTHER' ? { measurementDetail: `adsb.lol:${type}` } : {}),
    };
    return parsePositionObservation(observation);
  },
});
