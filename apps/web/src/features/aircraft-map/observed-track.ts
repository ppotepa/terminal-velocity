export interface TrackSegment {
  readonly breakBefore: string | null;
  readonly continuesPrevious: boolean;
  readonly points: readonly { readonly latitude: number; readonly longitude: number;
    readonly observedAtMs: number }[];
}
export interface TrackPage {
  readonly aircraftId: string;
  readonly segments: readonly TrackSegment[];
  readonly observedCount: number;
  readonly hasMore: boolean;
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function decodeTrackPage(value: unknown, aircraftId: string): TrackPage {
  if (!object(value) || !object(value['data'])) throw new TypeError('Invalid observed track response.');
  const data = value['data'];
  if (data['aircraftId'] !== aircraftId || !Array.isArray(data['segments'])
    || data['segments'].length > 500 || !Number.isSafeInteger(data['observedCount'])
    || Number(data['observedCount']) < 0 || Number(data['observedCount']) > 500
    || typeof data['hasMore'] !== 'boolean') throw new TypeError('Invalid observed track response.');
  const segments: TrackSegment[] = [];
  let count = 0;
  for (const raw of data['segments'] as unknown[]) {
    if (!object(raw) || !Array.isArray(raw['points']) || raw['points'].length > 500
      || !(raw['breakBefore'] === null || ['TIME_GAP','SAME_TIME_CONFLICT',
        'IMPLAUSIBLE_JUMP','ANTIMERIDIAN_WRAP'].includes(String(raw['breakBefore'])))
      || typeof raw['continuesPrevious'] !== 'boolean') throw new TypeError('Invalid track segment.');
    const points: TrackSegment['points'][number][] = [];
    for (const point of raw['points'] as unknown[]) {
      if (!object(point) || typeof point['latitude'] !== 'number' || Math.abs(point['latitude']) > 90
        || typeof point['longitude'] !== 'number' || Math.abs(point['longitude']) > 180
        || !Number.isSafeInteger(point['observedAtMs']) || Number(point['observedAtMs']) < 0)
        throw new TypeError('Invalid track point.');
      points.push({ latitude: point['latitude'], longitude: point['longitude'],
        observedAtMs: Number(point['observedAtMs']) });
    }
    count += points.length;
    if (count > 500) throw new TypeError('Observed track exceeds the point budget.');
    segments.push({ breakBefore: raw['breakBefore'] as string | null,
      continuesPrevious: raw['continuesPrevious'], points });
  }
  return { aircraftId, segments, observedCount: Number(data['observedCount']), hasMore: data['hasMore'] };
}

export function trackGeoJson(page: TrackPage | null) {
  return { type: 'FeatureCollection' as const, features: (page?.segments ?? [])
    .filter(segment => segment.points.length >= 2)
    .map((segment, index) => ({ type: 'Feature' as const, id: index,
      properties: { breakBefore: segment.breakBefore ?? '' },
      geometry: { type: 'LineString' as const,
        coordinates: segment.points.map(point => [point.longitude, point.latitude]) } })) };
}
