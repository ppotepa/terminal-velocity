import type { StrongIdentifier } from '../../aircraft-correlation/public/index.ts';
import { resolveIdentityAt } from '../domain/resolve-identity-at.ts';
import type { IdentityReader } from '../ports/identity-reader.ts';

export function createResolveAircraft(reader: IdentityReader) {
  return async (identifiers: readonly StrongIdentifier[], observedAt: number) => {
    if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw new RangeError('Invalid observation time.');
    const snapshot = await reader.find(identifiers, observedAt);
    return resolveIdentityAt(identifiers, observedAt, snapshot.assertions, snapshot.revision,
      snapshot.completeness === 'COMPLETE');
  };
}
