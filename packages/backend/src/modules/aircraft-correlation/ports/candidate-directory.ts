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
  /** COMPLETE oznacza pełny zbiór dla zadanych identyfikatorów/czasu, nie cały rejestr. */
  find(input: CorrelationInput): Promise<CandidateSnapshot>;
}
