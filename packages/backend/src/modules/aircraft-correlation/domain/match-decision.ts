import type { AircraftId, MessageId } from '../../../contracts/identity/index.ts';
import type { CatalogConflict } from './catalog-conflict.ts';
import type { CandidateEvaluation } from './candidate-evaluation.ts';
interface DecisionBase {
  readonly messageId: MessageId;
  readonly policyVersion: 'aircraft-identity/2';
  readonly evaluations: readonly CandidateEvaluation[];
}
export type MatchDecision = DecisionBase & (
  | { readonly status: 'MATCHED'; readonly aircraftId: AircraftId; readonly basis: 'EXACT_ACTIVE_IDENTIFIER' }
  | { readonly status: 'UNMATCHED'; readonly reason: 'NO_STRONG_IDENTIFIERS' | 'NO_MATCH' }
  | { readonly status: 'AMBIGUOUS'; readonly candidates: readonly AircraftId[] }
  | { readonly status: 'CONFLICTED'; readonly reason: 'STRONG_IDENTIFIER_DISAGREEMENT' | CatalogConflict }
);
