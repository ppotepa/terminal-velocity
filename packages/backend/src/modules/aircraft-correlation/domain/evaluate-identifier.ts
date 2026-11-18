import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { AircraftCandidate } from './aircraft-candidate.ts';
import type { IdentifierEvidence } from './identifier-evidence.ts';
import type { StrongIdentifier } from './strong-identifier.ts';
import { isAliasActive } from './temporal-alias.ts';
export function evaluateIdentifier(
  identifier: StrongIdentifier, candidate: AircraftCandidate, at: EpochMillis,
): IdentifierEvidence {
  const active = candidate.aliases.filter(alias =>
    alias.identifier.kind === identifier.kind && isAliasActive(alias, at));
  const distinctValues = new Set(active.map(alias => alias.identifier.value));
  const verdict = active.length === 0 ? 'ABSENT'
    : distinctValues.size > 1 ? 'CONFLICT'
    : distinctValues.has(identifier.value) ? 'SUPPORT' : 'CONFLICT';
  return { identifier, verdict, rule: 'EXACT_ACTIVE_IDENTIFIER_V1' };
}
