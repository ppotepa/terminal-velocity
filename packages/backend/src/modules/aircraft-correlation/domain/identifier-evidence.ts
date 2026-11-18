import type { StrongIdentifier } from './strong-identifier.ts';
export type IdentifierEvidence = {
  readonly identifier: StrongIdentifier;
  readonly verdict: 'SUPPORT' | 'CONFLICT' | 'ABSENT';
  readonly rule: 'EXACT_ACTIVE_IDENTIFIER_V1';
};
