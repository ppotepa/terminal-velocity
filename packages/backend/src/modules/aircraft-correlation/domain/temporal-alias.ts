import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { StrongIdentifier } from './strong-identifier.ts';
export type TemporalAlias = {
  readonly identifier: StrongIdentifier;
  readonly validFrom: EpochMillis;
  /** Half-open interval, inclusive at the start and exclusive at the end: [from, until). */
  readonly validUntil: EpochMillis | null;
};
export function isAliasActive(alias: TemporalAlias, at: EpochMillis): boolean {
  return alias.validFrom <= at && (alias.validUntil === null || at < alias.validUntil);
}
