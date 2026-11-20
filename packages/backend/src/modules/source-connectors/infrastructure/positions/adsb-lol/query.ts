import { err, ok, type Result } from '../../../../../kernel/result.ts';
import {
  latitudeDegrees, longitudeDegrees, type LatitudeDegrees, type LongitudeDegrees,
} from '../../../../flight-tracking/public/index.ts';

export const ADSB_LOL_MAX_RADIUS_NM = 50;

export interface AdsbLolPositionQuery {
  readonly latitude: LatitudeDegrees;
  readonly longitude: LongitudeDegrees;
  readonly radiusNm: number;
}

export type InvalidAdsbLolQuery = {
  readonly code: 'INVALID_QUERY';
  readonly field: 'latitude' | 'longitude' | 'radiusNm';
};

/** Keeps the provider query within a narrow local circle, even though upstream allows 250 NM. */
export function adsbLolPositionQuery(input: unknown): Result<AdsbLolPositionQuery, InvalidAdsbLolQuery> {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    return err({ code: 'INVALID_QUERY', field: 'latitude' });
  let record: Record<string, unknown>;
  try {
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null)
      return err({ code: 'INVALID_QUERY', field: 'latitude' });
    record = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== 'string') return err({ code: 'INVALID_QUERY', field: 'latitude' });
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !('value' in descriptor)) return err({ code: 'INVALID_QUERY', field: 'latitude' });
      record[key] = descriptor.value;
    }
  } catch {
    return err({ code: 'INVALID_QUERY', field: 'latitude' });
  }
  if (Object.keys(record).some(key => !['latitude', 'longitude', 'radiusNm'].includes(key)))
    return err({ code: 'INVALID_QUERY', field: 'radiusNm' });
  const latitude = latitudeDegrees(record['latitude']);
  if (!latitude.ok) return err({ code: 'INVALID_QUERY', field: 'latitude' });
  const longitude = longitudeDegrees(record['longitude']);
  if (!longitude.ok) return err({ code: 'INVALID_QUERY', field: 'longitude' });
  const radiusNm = record['radiusNm'];
  if (typeof radiusNm !== 'number' || !Number.isSafeInteger(radiusNm) || radiusNm < 1
    || radiusNm > ADSB_LOL_MAX_RADIUS_NM)
    return err({ code: 'INVALID_QUERY', field: 'radiusNm' });
  return ok(Object.freeze({ latitude: latitude.value, longitude: longitude.value, radiusNm }));
}

export function adsbLolPointUrl(query: AdsbLolPositionQuery): string {
  const latitude = encodeURIComponent(String(query.latitude));
  const longitude = encodeURIComponent(String(query.longitude));
  return `https://api.adsb.lol/v2/lat/${latitude}/lon/${longitude}/dist/${query.radiusNm}`;
}
