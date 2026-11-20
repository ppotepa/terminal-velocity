import type { PositionObservation } from './position-observation.ts';

export interface PositionEvidenceRank {
  readonly observedAtMs: number;
  readonly nic: number | null;
  readonly nacP: number | null;
  readonly containmentRadiusMeters: number | null;
  readonly measurementRank: 1 | 2 | 3;
  readonly sourcePriority: number;
  readonly sourceId: string;
  /** Immutable UUID of the stored fact, independent of delivery order. */
  readonly observationId: string;
}

export function measurementRank(kind: PositionObservation['measurementKind']): 1 | 2 | 3 {
  return kind === 'ADS_B' ? 3 : kind === 'MLAT' ? 2 : 1;
}

/** Later observed time wins. Quality, measurement and configured source priority break ties. */
export function comparePositionEvidence(a: PositionEvidenceRank, b: PositionEvidenceRank): number {
  const descending = (x: number, y: number) => x === y ? 0 : x > y ? 1 : -1;
  const nullableDescending = (x: number | null, y: number | null) =>
    x === null ? (y === null ? 0 : -1) : y === null ? 1 : descending(x, y);
  const nullableAscending = (x: number | null, y: number | null) =>
    x === null ? (y === null ? 0 : -1) : y === null ? 1 : descending(y, x);
  return descending(a.observedAtMs, b.observedAtMs)
    || nullableDescending(a.nic, b.nic)
    || nullableDescending(a.nacP, b.nacP)
    || nullableAscending(a.containmentRadiusMeters, b.containmentRadiusMeters)
    || descending(a.measurementRank, b.measurementRank)
    || descending(a.sourcePriority, b.sourcePriority)
    || (a.sourceId < b.sourceId ? 1 : a.sourceId > b.sourceId ? -1 : 0)
    || (a.observationId < b.observationId ? 1 : a.observationId > b.observationId ? -1 : 0);
}
