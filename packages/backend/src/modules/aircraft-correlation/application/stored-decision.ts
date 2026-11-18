import type { Revision } from '../../../contracts/identity/index.ts';
import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { MatchDecision } from '../domain/match-decision.ts';
export interface StoredDecision {
  readonly revision: Revision;
  readonly decidedAt: EpochMillis;
  readonly directoryRevision: string;
  readonly decision: MatchDecision;
}
