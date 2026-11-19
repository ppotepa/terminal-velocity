import { revision } from '../../../contracts/identity/index.ts';
import { epochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { StoredDecision } from './stored-decision.ts';
import { decodeMatchDecision } from './decoding/decode-match-decision.ts';
import { checkedValue, numberValue, recordValue, stringValue } from './decoding/value-readers.ts';

/** Validate the persisted contract and detach every nested object from its input. */
export function decodeStoredDecision(input: unknown): StoredDecision {
  const value = recordValue(input, ['revision', 'decidedAt', 'directoryRevision', 'decision']);
  return {
    revision: checkedValue(revision(numberValue(value.revision))),
    decidedAt: checkedValue(epochMillis(numberValue(value.decidedAt))),
    directoryRevision: stringValue(value.directoryRevision),
    decision: decodeMatchDecision(value.decision),
  };
}
