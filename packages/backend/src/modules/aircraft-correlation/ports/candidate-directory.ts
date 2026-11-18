import type { AircraftCandidate } from '../domain/aircraft-candidate.ts';
import type { CorrelationInput } from '../domain/correlation-input.ts';
export type IncompleteCandidateReason = 'LIMIT_REACHED' | 'LOOKUP_FAILED' | 'BUDGET_EXHAUSTED';
export type CandidateSnapshot = {
  readonly revision: string;
  readonly candidates: readonly AircraftCandidate[];
} & (
  | { readonly completeness: 'COMPLETE' }
  | { readonly completeness: 'PARTIAL'; readonly reason: IncompleteCandidateReason }
);
export interface CandidateDirectory {
  /** COMPLETE means the full candidate set for the requested identifiers/time, not the entire registry. */
  find(input: CorrelationInput): Promise<CandidateSnapshot>;
}
