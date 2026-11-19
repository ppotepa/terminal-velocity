import { aircraftId } from '../../../../contracts/identity/index.ts';
import type { CandidateEvaluation } from '../../domain/candidate-evaluation.ts';
import { decodeIdentifierEvidence } from './decode-identifier-evidence.ts';
import { arrayValue, booleanValue, checkedValue, recordValue, stringValue } from './value-readers.ts';

export function decodeCandidateEvaluation(input: unknown): CandidateEvaluation {
  const value = recordValue(input, ['aircraftId', 'evidence', 'supports', 'conflicts']);
  return {
    aircraftId: checkedValue(aircraftId(stringValue(value.aircraftId))),
    evidence: arrayValue(value.evidence).map(decodeIdentifierEvidence),
    supports: booleanValue(value.supports),
    conflicts: booleanValue(value.conflicts),
  };
}
