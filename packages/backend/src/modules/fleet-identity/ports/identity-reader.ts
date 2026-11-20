import type { StrongIdentifier } from '../../aircraft-correlation/public/index.ts';
import type { IdentityAssertion } from '../domain/identity-assertion.ts';
import type { AircraftId } from '../../../contracts/identity/aircraft-id.ts';

export interface IdentitySnapshot {
  readonly revision: number;
  readonly assertions: readonly IdentityAssertion[];
  readonly completeness: 'COMPLETE' | 'PARTIAL';
}
export interface IdentityReader {
  find(identifiers: readonly StrongIdentifier[], observedAt: number): Promise<IdentitySnapshot>;
  /** Keyset page; continue with the last returned assertionId. */
  history(aircraftId: AircraftId, afterAssertionId?: number, limit?: number): Promise<readonly IdentityAssertion[]>;
}
