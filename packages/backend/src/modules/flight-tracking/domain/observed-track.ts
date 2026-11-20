import type { PositionMeasurementKind } from './position-measurement.ts';
import type { PositionQuality } from './position-quality.ts';
import type { PositionTimePrecision } from './position-time.ts';
import type { PositionSourceId } from './position-identifiers.ts';

export interface ObservedTrackPoint {
  readonly observationId: string;
  readonly sourceId: PositionSourceId;
  readonly sourceObservationId: string;
  readonly observedAtMs: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly measurementKind: PositionMeasurementKind;
  readonly quality: PositionQuality | null;
  readonly timestampPrecision: PositionTimePrecision;
  readonly timestampUncertaintyMs: number | null;
}

export type TrackBreakReason = 'TIME_GAP' | 'SAME_TIME_CONFLICT'
  | 'IMPLAUSIBLE_JUMP' | 'ANTIMERIDIAN_WRAP';

export interface ObservedTrackSegment {
  readonly breakBefore: TrackBreakReason | null;
  /** The first page point connects to the prior page's last observed point. */
  readonly continuesPrevious: boolean;
  readonly points: readonly ObservedTrackPoint[];
}

export interface TrackGapPolicy {
  readonly maxGapMs: number;
  readonly maxSpeedKnots: number;
}

export const DEFAULT_TRACK_GAP_POLICY: TrackGapPolicy = Object.freeze({
  maxGapMs: 10 * 60_000, maxSpeedKnots: 1_200,
});

function validatePoint(point: ObservedTrackPoint): void {
  if (!Number.isSafeInteger(point.observedAtMs) || point.observedAtMs < 0
    || !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90
    || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180
    || !point.sourceId || !point.sourceObservationId || !point.observationId)
    throw new RangeError('Invalid observed track point.');
}

function order(a: ObservedTrackPoint, b: ObservedTrackPoint): number {
  return a.observedAtMs - b.observedAtMs
    || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0)
    || (a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0);
}

/** Great-circle distance with wrapped longitude, so a dateline crossing is not a huge jump. */
function distanceKm(a: ObservedTrackPoint, b: ObservedTrackPoint): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (b.latitude - a.latitude) * radians;
  let longitudeDelta = b.longitude - a.longitude;
  if (longitudeDelta > 180) longitudeDelta -= 360;
  if (longitudeDelta < -180) longitudeDelta += 360;
  const lon = longitudeDelta * radians;
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(lon / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function breakBetween(a: ObservedTrackPoint, b: ObservedTrackPoint,
  policy: TrackGapPolicy): TrackBreakReason | null {
  const elapsed = b.observedAtMs - a.observedAtMs;
  if (elapsed > policy.maxGapMs) return 'TIME_GAP';
  const distance = distanceKm(a, b);
  if (elapsed === 0 && distance > 0.001) return 'SAME_TIME_CONFLICT';
  if (elapsed > 0 && distance / (elapsed / 3_600_000) / 1.852 > policy.maxSpeedKnots)
    return 'IMPLAUSIBLE_JUMP';
  if (Math.abs(b.longitude - a.longitude) > 180) return 'ANTIMERIDIAN_WRAP';
  return null;
}

/** Only supplied observations become points; unknown gaps and wraps split geometry. */
export function buildObservedTrack(points: readonly ObservedTrackPoint[],
  previous: ObservedTrackPoint | null = null,
  policy: TrackGapPolicy = DEFAULT_TRACK_GAP_POLICY): readonly ObservedTrackSegment[] {
  if (!Number.isSafeInteger(policy.maxGapMs) || policy.maxGapMs < 1
    || !Number.isFinite(policy.maxSpeedKnots) || policy.maxSpeedKnots <= 0
    || points.length > 500) throw new RangeError('Invalid observed track policy or page size.');
  for (const point of points) validatePoint(point);
  if (previous) validatePoint(previous);
  const ordered = [...points].sort(order);
  const unique: ObservedTrackPoint[] = [];
  const seen = new Map<string, ObservedTrackPoint>();
  for (const point of ordered) {
    const key = `${point.sourceId}\0${point.observationId}`;
    const existing = seen.get(key);
    if (existing) {
      if (existing.observedAtMs !== point.observedAtMs || existing.latitude !== point.latitude
        || existing.longitude !== point.longitude || existing.sourceObservationId !== point.sourceObservationId)
        throw new Error('Conflicting repeated observed track fact.');
      continue;
    }
    seen.set(key, point);
    unique.push(point);
  }
  if (!unique.length) return [];
  if (previous && order(previous, unique[0]!) >= 0)
    throw new RangeError('Observed track cursor does not precede the page.');
  const firstBreak = previous ? breakBetween(previous, unique[0]!, policy) : null;
  const segments: { breakBefore: TrackBreakReason | null;
    continuesPrevious: boolean; points: ObservedTrackPoint[] }[] = [{
      breakBefore: firstBreak, continuesPrevious: previous !== null && firstBreak === null,
      points: [unique[0]!],
    }];
  for (let index = 1; index < unique.length; index++) {
    const reason = breakBetween(unique[index - 1]!, unique[index]!, policy);
    if (reason) segments.push({ breakBefore: reason, continuesPrevious: false, points: [unique[index]!] });
    else segments.at(-1)!.points.push(unique[index]!);
  }
  return segments;
}

function errorSquared(a: ObservedTrackPoint, b: ObservedTrackPoint,
  c: ObservedTrackPoint): number {
  const scale = Math.cos(((a.latitude + c.latitude) / 2) * Math.PI / 180);
  const x = (b.longitude - a.longitude) * scale;
  const y = b.latitude - a.latitude;
  const dx = (c.longitude - a.longitude) * scale;
  const dy = c.latitude - a.latitude;
  const length = dx * dx + dy * dy;
  if (length === 0) return x * x + y * y;
  const t = Math.max(0, Math.min(1, (x * dx + y * dy) / length));
  return (x - t * dx) ** 2 + (y - t * dy) ** 2;
}

/** Deterministic endpoint-preserving simplification; budget can override zoom tolerance. */
export function simplifyObservedTrack(segments: readonly ObservedTrackSegment[],
  pointBudget: number, zoom: number): readonly ObservedTrackSegment[] {
  if (!Number.isSafeInteger(pointBudget) || pointBudget < 1 || pointBudget > 500
    || !Number.isFinite(zoom) || zoom < 0 || zoom > 22)
    throw new RangeError('Invalid observed track simplification budget.');
  const result = segments.map(segment => ({ ...segment, points: [...segment.points] }));
  let count = result.reduce((total, segment) => total + segment.points.length, 0);
  if (count > 500) throw new RangeError('Observed track page exceeds 500 points.');
  const minimum = result.reduce((total, segment) => total + Math.min(2, segment.points.length), 0);
  if (minimum > pointBudget) throw new RangeError('Point budget cannot preserve every segment endpoint.');
  const toleranceSquared = (360 / (2 ** (zoom + 9))) ** 2;
  while (true) {
    let selected: { segment: number; point: number; error: number } | null = null;
    for (let segment = 0; segment < result.length; segment++) {
      const values = result[segment]!.points;
      for (let point = 1; point + 1 < values.length; point++) {
        const error = errorSquared(values[point - 1]!, values[point]!, values[point + 1]!);
        if (!selected || error < selected.error)
          selected = { segment, point, error };
      }
    }
    if (!selected || (count <= pointBudget && selected.error > toleranceSquared)) break;
    result[selected.segment]!.points.splice(selected.point, 1);
    count--;
  }
  return result;
}
