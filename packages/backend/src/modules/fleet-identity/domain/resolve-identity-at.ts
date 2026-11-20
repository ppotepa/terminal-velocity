import type { AircraftId } from '../../../contracts/identity/aircraft-id.ts';
import type { StrongIdentifier } from '../../../contracts/identity/aircraft-alias.ts';
import type { IdentityAssertion } from './identity-assertion.ts';

export type IdentityResolution =
  | { readonly status: 'MATCHED'; readonly aircraftId: AircraftId; readonly revision: number }
  | { readonly status: 'AMBIGUOUS'; readonly candidateIds: readonly AircraftId[]; readonly revision: number }
  | { readonly status: 'CONFLICTED'; readonly candidateIds: readonly AircraftId[]; readonly revision: number }
  | { readonly status: 'UNMATCHED'; readonly revision: number }
  | { readonly status: 'INCOMPLETE'; readonly reason: 'LOOKUP_FAILED' | 'LIMIT_REACHED'; readonly revision: number };

/** Assertions passed here are the current recorded revisions; validity is tested at observation time. */
export function resolveIdentityAt(identifiers: readonly StrongIdentifier[], observedAt: number,
  assertions: readonly IdentityAssertion[], revision: number, complete = true): IdentityResolution {
  if (!complete) return { status: 'INCOMPLETE', reason: 'LIMIT_REACHED', revision };
  const sets = identifiers.map(identifier => new Set(assertions.filter(assertion =>
    assertion.identifier.kind === identifier.kind && assertion.identifier.value === identifier.value
    && assertion.validFrom <= observedAt
    && (assertion.validUntil === null || observedAt < assertion.validUntil))
    .map(assertion => assertion.aircraftId))).filter(set => set.size > 0);
  if (sets.length === 0) return { status: 'UNMATCHED', revision };
  const candidateIds = [...new Set(sets.flatMap(set => [...set]))].sort() as AircraftId[];
  // Correlation vetoes a candidate with simultaneous distinct values of one
  // identifier kind. Position links must apply the same rule to the full catalog.
  for (const aircraftId of candidateIds) {
    const activeByKind = new Map<StrongIdentifier['kind'], Set<string>>();
    for (const assertion of assertions) {
      if (assertion.aircraftId !== aircraftId || assertion.validFrom > observedAt
        || (assertion.validUntil !== null && observedAt >= assertion.validUntil)) continue;
      const values = activeByKind.get(assertion.identifier.kind) ?? new Set<string>();
      values.add(assertion.identifier.value);
      if (values.size > 1) return { status: 'CONFLICTED', candidateIds, revision };
      activeByKind.set(assertion.identifier.kind, values);
    }
    // An unknown supplied identifier still contradicts a different active
    // value of the same kind on a candidate supported by another identifier.
    for (const identifier of identifiers) {
      const values = activeByKind.get(identifier.kind);
      if (values && !values.has(identifier.value))
        return { status: 'CONFLICTED', candidateIds, revision };
    }
  }
  if (sets.some(set => set.size > 1)) return { status: 'AMBIGUOUS', candidateIds, revision };
  if (candidateIds.length > 1) return { status: 'CONFLICTED', candidateIds, revision };
  return { status: 'MATCHED', aircraftId: candidateIds[0]!, revision };
}
