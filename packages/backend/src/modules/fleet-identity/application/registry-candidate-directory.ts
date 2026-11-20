import type { CandidateDirectory, AircraftCandidate } from '../../aircraft-correlation/public/index.ts';
import type { IdentityReader } from '../ports/identity-reader.ts';
import { epochMillis } from '../../../kernel/time/epoch-millis.ts';

export function createRegistryCandidateDirectory(reader: IdentityReader): CandidateDirectory {
  return { async find(input) {
    const snapshot = await reader.find(input.identifiers, input.effectiveAt);
    const byId = new Map<string, AircraftCandidate>();
    for (const assertion of snapshot.assertions) {
      const existing = byId.get(assertion.aircraftId);
      const from = epochMillis(assertion.validFrom);
      const until = assertion.validUntil === null ? null : epochMillis(assertion.validUntil);
      if (!from.ok || (until !== null && !until.ok)) throw new Error('Invalid stored alias validity.');
      const aliases = [...(existing?.aliases ?? []), { identifier: assertion.identifier,
        validFrom: from.value, validUntil: until?.value ?? null }];
      byId.set(assertion.aircraftId, { aircraftId: assertion.aircraftId, aliases });
    }
    return snapshot.completeness === 'COMPLETE'
      ? { revision: `fleet/${snapshot.revision}`, completeness: 'COMPLETE', candidates: [...byId.values()] }
      : { revision: `fleet/${snapshot.revision}`, completeness: 'PARTIAL', reason: 'LIMIT_REACHED', candidates: [...byId.values()] };
  } };
}
