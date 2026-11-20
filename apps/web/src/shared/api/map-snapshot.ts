export interface MapAircraft {
  readonly aircraftId: string;
  readonly position: {
    readonly latitude: number;
    readonly longitude: number;
    readonly observedAt: string;
    readonly freshness: 'CURRENT' | 'STALE' | 'UNKNOWN';
    readonly source: string;
    readonly measurementKind: 'ADS_B' | 'MLAT' | 'OTHER' | 'DEMO';
    readonly headingDegrees?: number;
  };
  readonly messages: {
    readonly freshness: 'RECENT' | 'STALE' | 'NONE';
    readonly lastMessageAt: string | null;
    readonly coverage: 'UNKNOWN';
    readonly feedHealth: 'DISCONNECTED';
  };
}
export interface MapSnapshot {
  readonly data: readonly MapAircraft[];
  readonly nextCursor: string | null;
  readonly asOf: string;
  readonly checkpoint: number;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate the small wire surface before presentation code trusts it. */
export function decodeMapSnapshot(value: unknown): MapSnapshot {
  if (!record(value) || !Array.isArray(value['data']) || value['data'].length > 500
    || typeof value['asOf'] !== 'string' || !Number.isFinite(Date.parse(value['asOf']))
    || !Number.isSafeInteger(value['checkpoint']) || Number(value['checkpoint']) < 0
    || !(value['nextCursor'] === null || typeof value['nextCursor'] === 'string'))
    throw new TypeError('Invalid map snapshot response.');
  const data: MapAircraft[] = [];
  for (const item of value['data'] as unknown[]) {
    if (!record(item) || typeof item['aircraftId'] !== 'string'
      || !/^ac_[A-Za-z0-9-]{1,64}$/.test(item['aircraftId'])
      || !record(item['position']) || !record(item['messages']))
      throw new TypeError('Invalid map aircraft response.');
    const position = item['position'], messages = item['messages'];
    if (typeof position['latitude'] !== 'number' || !Number.isFinite(position['latitude'])
      || position['latitude'] < -90 || position['latitude'] > 90
      || typeof position['longitude'] !== 'number' || !Number.isFinite(position['longitude'])
      || position['longitude'] < -180 || position['longitude'] > 180
      || typeof position['observedAt'] !== 'string' || !Number.isFinite(Date.parse(position['observedAt']))
      || !['CURRENT','STALE','UNKNOWN'].includes(String(position['freshness']))
      || typeof position['source'] !== 'string' || !['ADS_B','MLAT','OTHER','DEMO'].includes(String(position['measurementKind']))
      || (position['headingDegrees'] !== undefined && (typeof position['headingDegrees'] !== 'number'
        || !Number.isFinite(position['headingDegrees']) || position['headingDegrees'] < 0
        || position['headingDegrees'] >= 360))
      || !['RECENT','STALE','NONE'].includes(String(messages['freshness']))
      || !(messages['lastMessageAt'] === null || (typeof messages['lastMessageAt'] === 'string'
        && Number.isFinite(Date.parse(messages['lastMessageAt']))))
      || messages['coverage'] !== 'UNKNOWN' || messages['feedHealth'] !== 'DISCONNECTED')
      throw new TypeError('Invalid map aircraft response.');
    data.push({
      aircraftId: item['aircraftId'],
      position: {
        latitude: position['latitude'], longitude: position['longitude'],
        observedAt: position['observedAt'],
        freshness: position['freshness'] as MapAircraft['position']['freshness'],
        source: position['source'],
        measurementKind: position['measurementKind'] as MapAircraft['position']['measurementKind'],
        ...(position['headingDegrees'] === undefined ? {} : { headingDegrees: position['headingDegrees'] as number }),
      },
      messages: {
        freshness: messages['freshness'] as MapAircraft['messages']['freshness'],
        lastMessageAt: messages['lastMessageAt'], coverage: 'UNKNOWN', feedHealth: 'DISCONNECTED',
      },
    });
  }
  return { data, nextCursor: value['nextCursor'], asOf: value['asOf'],
    checkpoint: Number(value['checkpoint']) };
}
