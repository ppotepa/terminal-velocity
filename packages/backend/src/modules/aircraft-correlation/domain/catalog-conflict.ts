import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { AircraftCandidate } from './aircraft-candidate.ts';
import type { StrongIdentifier } from './strong-identifier.ts';
import { isAliasActive } from './temporal-alias.ts';
export type CatalogConflict = 'DUPLICATE_CANDIDATE' | 'CONFLICTING_ACTIVE_ALIASES';
/** Selecting a matching record must not hide a catalog inconsistency. */
export function findCatalogConflict(candidates: readonly AircraftCandidate[], at: EpochMillis): CatalogConflict | null {
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ids.has(candidate.aircraftId)) return 'DUPLICATE_CANDIDATE';
    ids.add(candidate.aircraftId);
  }
  for (const candidate of candidates) {
    const activeValues = new Map<StrongIdentifier['kind'], Set<string>>();
    for (const alias of candidate.aliases) {
      if (!isAliasActive(alias, at)) continue;
      const values = activeValues.get(alias.identifier.kind) ?? new Set<string>();
      values.add(alias.identifier.value);
      activeValues.set(alias.identifier.kind, values);
      if (values.size > 1) return 'CONFLICTING_ACTIVE_ALIASES';
    }
  }
  return null;
}
