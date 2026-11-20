import type { AircraftId } from '../../../contracts/identity/aircraft-id.ts';
import type { IdentityResolution } from '../domain/resolve-identity-at.ts';
export interface PositionLinkDecision {
  readonly sourceId: string;
  readonly sourceObservationId: string;
  readonly revision: number;
  readonly registryRevision: number;
  readonly status: IdentityResolution['status'];
  readonly aircraftId: AircraftId | null;
}
export interface PositionLinker {
  /** A decision revision is appended only when the registry revision or decision changes. */
  reevaluate(sourceId: string, sourceObservationId: string): Promise<PositionLinkDecision>;
  /** Bounded replay of positions whose ICAO24 hint and observation time intersect a corrected assertion. */
  replayAlias(icao24: string, from: number, until: number | null, limit: number,
    after?: { observedAt: number; sourceId: string; sourceObservationId: string }):
    Promise<{ decisions: readonly PositionLinkDecision[]; next: { observedAt: number; sourceId: string; sourceObservationId: string } | null }>;
}
