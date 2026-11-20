/** MapLibre can report wrapped longitudes and a viewport larger than the API limit. */
export function boundedBbox(west: number, south: number, east: number, north: number): string {
  if (![west, south, east, north].every(Number.isFinite) || east < west || north < south)
    throw new RangeError('Invalid map bounds.');
  const centerLon = (west + east) / 2;
  const halfWidth = Math.min((east - west) / 2, 44.999);
  const centerLat = Math.max(-85, Math.min(85, (south + north) / 2));
  const halfHeight = Math.min((north - south) / 2, 29.999, 90 - Math.abs(centerLat));
  const wrap = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
  const n = (value: number) => Number(value.toFixed(5));
  return [n(wrap(centerLon - halfWidth)), n(centerLat - halfHeight),
    n(wrap(centerLon + halfWidth)), n(centerLat + halfHeight)].join(',');
}
