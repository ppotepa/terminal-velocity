import type { AircraftId } from '../../../contracts/identity/index.ts';
import type { IdentifierEvidence } from './identifier-evidence.ts';
export interface CandidateEvaluation {
  readonly aircraftId: AircraftId;
  readonly evidence: readonly IdentifierEvidence[];
  readonly supports: boolean;
  readonly conflicts: boolean;
}
