import { aircraftId, messageId } from '../../../../contracts/identity/index.ts';
import type { MatchDecision } from '../../domain/match-decision.ts';
import { decodeCandidateEvaluation } from './decode-candidate-evaluation.ts';
import { arrayValue, checkedValue, invalidDecision, oneOf, recordValue, stringValue } from './value-readers.ts';

const baseKeys = ['messageId', 'policyVersion', 'evaluations', 'status'];

export function decodeMatchDecision(input: unknown): MatchDecision {
  if (typeof input !== 'object' || input === null || !('status' in input)) return invalidDecision('decision');
  const status = oneOf(input.status, ['MATCHED', 'UNMATCHED', 'AMBIGUOUS', 'CONFLICTED']);
  const variantKeys = status === 'MATCHED' ? ['aircraftId', 'basis']
    : status === 'AMBIGUOUS' ? ['candidates'] : ['reason'];
  const value = recordValue(input, [...baseKeys, ...variantKeys]);
  const base = {
    messageId: checkedValue(messageId(stringValue(value.messageId))),
    policyVersion: oneOf(value.policyVersion, ['aircraft-identity/2']),
    evaluations: arrayValue(value.evaluations).map(decodeCandidateEvaluation),
  };
  switch (status) {
    case 'MATCHED':
      return { ...base, status, aircraftId: checkedValue(aircraftId(stringValue(value.aircraftId))),
        basis: oneOf(value.basis, ['EXACT_ACTIVE_IDENTIFIER']) };
    case 'UNMATCHED':
      return { ...base, status, reason: oneOf(value.reason, ['NO_STRONG_IDENTIFIERS', 'NO_MATCH']) };
    case 'AMBIGUOUS': {
      const candidates = arrayValue(value.candidates).map(item => checkedValue(aircraftId(stringValue(item))));
      if (candidates.length < 2 || new Set(candidates).size !== candidates.length)
        return invalidDecision('ambiguous candidates');
      return { ...base, status, candidates };
    }
    case 'CONFLICTED':
      return { ...base, status, reason: oneOf(value.reason,
        ['STRONG_IDENTIFIER_DISAGREEMENT', 'DUPLICATE_CANDIDATE', 'CONFLICTING_ACTIVE_ALIASES']) };
  }
}
