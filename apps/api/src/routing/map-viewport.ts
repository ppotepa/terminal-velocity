import { Buffer } from 'node:buffer';
import { mapViewportQuery, type MapCursor, type MapPage, type MapQuery } from '@airframes/backend/map';
import { HttpProblem } from '../http/http-problem.ts';

/** Decode only the small, documented query vocabulary. */
export function parseMapViewport(search: string): MapQuery {
  const params = new URLSearchParams(search);
  const allowed = new Set(['bbox', 'limit', 'cursor', 'positionStatus', 'messageStatus', 'protocol']);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1)
      throw new HttpProblem(400, 'INVALID_MAP_QUERY', 'Unsupported or repeated map query parameter.');
  }
  const rawBounds = params.get('bbox')?.split(',');
  if (rawBounds?.length !== 4 || rawBounds.some(value => !/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)))
    throw new HttpProblem(400, 'INVALID_MAP_QUERY', 'The bbox must contain four finite decimal coordinates.');
  const rawLimit = params.get('limit') ?? '500';
  if (!/^[1-9]\d{0,2}$/.test(rawLimit))
    throw new HttpProblem(400, 'INVALID_MAP_QUERY', 'The limit must be from 1 to 500.');
  const rawCursor = params.get('cursor');
  let cursor: MapCursor | undefined;
  if (rawCursor !== null) {
    if (rawCursor.length < 1 || rawCursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(rawCursor))
      throw new HttpProblem(400, 'INVALID_MAP_QUERY', 'The map cursor is malformed.');
    try {
      const decoded: unknown = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'));
      if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)
        || Object.keys(decoded).sort().join(',') !== 'after,asOf,queryKey,revision') throw new Error();
      cursor = decoded as MapCursor;
    } catch { throw new HttpProblem(400, 'INVALID_MAP_QUERY', 'The map cursor is malformed.'); }
  }
  try {
    return mapViewportQuery({
      bbox: { west: Number(rawBounds[0]), south: Number(rawBounds[1]),
        east: Number(rawBounds[2]), north: Number(rawBounds[3]) },
      limit: Number(rawLimit),
      ...(params.has('positionStatus') ? { positionStatus: params.get('positionStatus') as NonNullable<MapQuery['positionStatus']> } : {}),
      ...(params.has('messageStatus') ? { messageStatus: params.get('messageStatus') as NonNullable<MapQuery['messageStatus']> } : {}),
      ...(params.has('protocol') ? { protocol: params.get('protocol') as NonNullable<MapQuery['protocol']> } : {}),
      ...(cursor ? { cursor } : {}),
    });
  } catch { throw new HttpProblem(400, 'INVALID_MAP_QUERY', 'The map viewport or filter is invalid.'); }
}

export function mapHttpPage(page: MapPage) {
  return { data: page.data, asOf: page.asOf, checkpoint: page.checkpoint,
    nextCursor: page.nextCursor ? Buffer.from(JSON.stringify(page.nextCursor)).toString('base64url') : null };
}
