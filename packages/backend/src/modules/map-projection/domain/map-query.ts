export const MAP_MAX_LIMIT = 500;
export interface MapBounds { readonly west: number; readonly south: number; readonly east: number; readonly north: number }
export interface MapCursor { readonly revision: number; readonly after: string; readonly asOf: string; readonly queryKey: string }
export interface MapQuery {
  readonly bbox: MapBounds;
  readonly limit: number;
  readonly positionStatus?: 'CURRENT' | 'STALE' | 'UNKNOWN';
  readonly messageStatus?: 'RECENT' | 'STALE' | 'NONE';
  readonly protocol?: 'VHF_ACARS' | 'VDL2' | 'HFDL' | 'SATCOM';
  readonly cursor?: MapCursor;
  readonly queryKey: string;
}
export type MapQueryInput = Omit<MapQuery, 'queryKey'>;

export function mapViewportQuery(input: MapQueryInput): MapQuery {
  const { west, south, east, north } = input.bbox;
  const valid = [west, south, east, north].every(Number.isFinite)
    && west >= -180 && west <= 180 && east >= -180 && east <= 180
    && south >= -90 && south <= 90 && north >= -90 && north <= 90
    && south <= north;
  const width = east >= west ? east - west : 180 - west + east + 180;
  if (!valid || width > 90 || north - south > 60)
    throw new RangeError('The bbox must be valid and span at most 90° longitude and 60° latitude.');
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MAP_MAX_LIMIT)
    throw new RangeError('The map limit must be between 1 and 500.');
  if (input.positionStatus !== undefined && !['CURRENT', 'STALE', 'UNKNOWN'].includes(input.positionStatus))
    throw new RangeError('Unsupported position status.');
  if (input.messageStatus !== undefined && !['RECENT', 'STALE', 'NONE'].includes(input.messageStatus))
    throw new RangeError('Unsupported message status.');
  if (input.protocol !== undefined && !['VHF_ACARS', 'VDL2', 'HFDL', 'SATCOM'].includes(input.protocol))
    throw new RangeError('Unsupported protocol.');
  const queryKey = JSON.stringify([west, south, east, north, input.positionStatus ?? null,
    input.messageStatus ?? null, input.protocol ?? null]);
  const cursor = input.cursor;
  if (cursor !== undefined && (cursor.queryKey !== queryKey
    || !Number.isSafeInteger(cursor.revision) || cursor.revision < 0
    || !/^ac_[A-Za-z0-9-]{1,64}$/.test(cursor.after)
    || !Number.isFinite(Date.parse(cursor.asOf)) || new Date(cursor.asOf).toISOString() !== cursor.asOf))
    throw new RangeError('The map cursor is invalid for this query.');
  return { ...input, queryKey };
}

export function withinMapBounds(latitude: number, longitude: number, bounds: MapBounds): boolean {
  return latitude >= bounds.south && latitude <= bounds.north
    && (bounds.west <= bounds.east
      ? longitude >= bounds.west && longitude <= bounds.east
      : longitude >= bounds.west || longitude <= bounds.east);
}
