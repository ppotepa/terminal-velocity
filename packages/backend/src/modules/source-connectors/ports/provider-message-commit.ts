import type { MessageId } from '../../../contracts/identity/index.ts';
import type { DecisionTransaction, StoredDecision } from '../../aircraft-correlation/public/index.ts';
import type { CanonicalSourceObservation } from '../domain/normalized-observation.ts';

export type ImportQuarantine = 'RETENTION_NOT_PERMITTED' | 'INVALID_CANONICAL' | 'UNSUPPORTED_LEVEL' | 'MISSING_OBSERVATION_TIME' | 'IDENTITY_CONFLICT';
export interface ProviderMessageCommit {
  readonly decisions: DecisionTransaction;
  read(): Promise<{ readonly decision: StoredDecision; readonly sameFacts: boolean } | null>;
  link(decision: StoredDecision): Promise<void>;
  insert(canonical: CanonicalSourceObservation): Promise<void>;
  quarantine(reason: ImportQuarantine): Promise<void>;
}
export type ProviderImportResult =
  | { readonly outcome: 'QUARANTINED'; readonly sourceDeliveryId: string; readonly reason: ImportQuarantine }
  | { readonly outcome: 'IMPORTED' | 'DUPLICATE' | 'UNMATCHED' | 'AMBIGUOUS' | 'CONFLICTED';
      readonly messageId: MessageId; readonly messageRevision: 1; readonly sourceDeliveryId: string;
      readonly observedAt: number; readonly decision: StoredDecision };
