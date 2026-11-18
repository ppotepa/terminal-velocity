import type { AircraftCandidate } from './aircraft-candidate.ts';
import type { CandidateEvaluation } from './candidate-evaluation.ts';
import type { CorrelationInput } from './correlation-input.ts';
import { evaluateIdentifier } from './evaluate-identifier.ts';
export function evaluateCandidate(input: CorrelationInput, candidate: AircraftCandidate): CandidateEvaluation {
  const evidence = input.identifiers.map(id => evaluateIdentifier(id, candidate, input.effectiveAt));
  return { aircraftId: candidate.aircraftId, evidence,
    supports: evidence.some(item => item.verdict === 'SUPPORT'),
    conflicts: evidence.some(item => item.verdict === 'CONFLICT') };
}
