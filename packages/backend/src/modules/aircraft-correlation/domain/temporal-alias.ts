import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { StrongIdentifier } from './strong-identifier.ts';
export type TemporalAlias = {
  readonly identifier: StrongIdentifier;
  readonly validFrom: EpochMillis;
  /** Przedział domknięty z lewej, otwarty z prawej: [from, until). */
  readonly validUntil: EpochMillis | null;
};
export function isAliasActive(alias: TemporalAlias, at: EpochMillis): boolean {
  return alias.validFrom <= at && (alias.validUntil === null || at < alias.validUntil);
}
