import type { StrongIdentifier } from '../../aircraft-correlation/public/index.ts';
import { resolveIdentityAt } from '../domain/resolve-identity-at.ts';
import type { IdentityReader } from '../ports/identity-reader.ts';

export function createResolveAircraft(reader: IdentityReader) {
  return async (identifiers: readonly StrongIdentifier[], observedAt: number) => {
    if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw new RangeError('Invalid observation time.');
    let snapshot: Awaited<ReturnType<IdentityReader['find']>>;
    try {
      snapshot = await reader.find(identifiers, observedAt);
    } catch {
      // No registry revision is trustworthy when the lookup itself failed.
      return { status: 'INCOMPLETE' as const, reason: 'LOOKUP_FAILED' as const, revision: 0 };
    }
    return resolveIdentityAt(identifiers, observedAt, snapshot.assertions, snapshot.revision,
      snapshot.completeness === 'COMPLETE');
  };
}
