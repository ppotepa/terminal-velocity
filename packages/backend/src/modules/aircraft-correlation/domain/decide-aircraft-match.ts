import type { AircraftCandidate } from './aircraft-candidate.ts';
import type { CorrelationInput } from './correlation-input.ts';
import type { MatchDecision } from './match-decision.ts';
import { findCatalogConflict } from './catalog-conflict.ts';
import { evaluateCandidate } from './evaluate-candidate.ts';
export function decideAircraftMatch(input: CorrelationInput, candidates: readonly AircraftCandidate[]): MatchDecision {
  const evaluations = [...candidates].sort((a, b) => a.aircraftId.localeCompare(b.aircraftId))
    .map(candidate => evaluateCandidate(input, candidate));
  const base = { messageId: input.messageId, policyVersion: 'aircraft-identity/2' as const, evaluations };
  const catalogConflict = findCatalogConflict(candidates, input.effectiveAt);
  if (catalogConflict !== null) return { ...base, status: 'CONFLICTED', reason: catalogConflict };
  if (input.identifiers.length === 0) return { ...base, status: 'UNMATCHED', reason: 'NO_STRONG_IDENTIFIERS' };
  // Two known strong identifiers must not point to disjoint sets of aircraft.
  const owners = input.identifiers.map(identifier => new Set(evaluations.filter(item =>
    item.evidence.some(evidence => evidence.verdict === 'SUPPORT' &&
      evidence.identifier.kind === identifier.kind && evidence.identifier.value === identifier.value))
    .map(item => item.aircraftId))).filter(set => set.size > 0);
  const firstOwners = owners[0];
  const commonOwners = firstOwners === undefined ? new Set<string>()
    : new Set([...firstOwners].filter(id => owners.every(set => set.has(id))));
  if (owners.length > 1 && commonOwners.size === 0)
    return { ...base, status: 'CONFLICTED', reason: 'STRONG_IDENTIFIER_DISAGREEMENT' };
  const eligible = evaluations.filter(item => item.supports && !item.conflicts && commonOwners.has(item.aircraftId));
  if (eligible.length > 1) return { ...base, status: 'AMBIGUOUS', candidates: eligible.map(item => item.aircraftId) };
  const winner = eligible[0];
  if (winner) return { ...base, status: 'MATCHED', aircraftId: winner.aircraftId, basis: 'EXACT_ACTIVE_IDENTIFIER' };
  if (evaluations.some(item => item.supports && item.conflicts))
    return { ...base, status: 'CONFLICTED', reason: 'STRONG_IDENTIFIER_DISAGREEMENT' };
  return { ...base, status: 'UNMATCHED', reason: 'NO_MATCH' };
}
