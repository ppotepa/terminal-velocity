import type { IdentifierEvidence } from '../../domain/identifier-evidence.ts';
import type { StrongIdentifier } from '../../domain/strong-identifier.ts';
import { icao24 } from '../../domain/icao24.ts';
import { registration } from '../../domain/registration.ts';
import { checkedValue, invalidDecision, oneOf, recordValue, stringValue } from './value-readers.ts';

function decodeIdentifier(input: unknown): StrongIdentifier {
  const value = recordValue(input, ['kind', 'value']);
  const kind = oneOf(value.kind, ['ICAO24', 'REGISTRATION']);
  const original = stringValue(value.value);
  if (kind === 'ICAO24') {
    const normalized = checkedValue(icao24(original));
    if (normalized !== original) return invalidDecision('noncanonical ICAO24');
    return { kind, value: normalized };
  }
  const normalized = checkedValue(registration(original));
  if (normalized !== original) return invalidDecision('noncanonical registration');
  return { kind, value: normalized };
}

export function decodeIdentifierEvidence(input: unknown): IdentifierEvidence {
  const value = recordValue(input, ['identifier', 'verdict', 'rule']);
  return {
    identifier: decodeIdentifier(value.identifier),
    verdict: oneOf(value.verdict, ['SUPPORT', 'CONFLICT', 'ABSENT']),
    rule: oneOf(value.rule, ['EXACT_ACTIVE_IDENTIFIER_V1']),
  };
}
