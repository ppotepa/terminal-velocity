import type { MessageId } from '../../../contracts/identity/index.ts';
import type { ContributionChange } from './contribution.ts';
/** Tombstone RETRACTED zostaje w ledgerze: stara wiadomość nie może jej wskrzesić. */
export type ContributionLedger = ReadonlyMap<MessageId, ContributionChange>;
