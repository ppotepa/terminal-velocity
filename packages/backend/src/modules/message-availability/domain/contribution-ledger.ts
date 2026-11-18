import type { MessageId } from '../../../contracts/identity/index.ts';
import type { ContributionChange } from './contribution.ts';
/** The RETRACTED tombstone remains in the ledger: an old message cannot revive the contribution. */
export type ContributionLedger = ReadonlyMap<MessageId, ContributionChange>;
