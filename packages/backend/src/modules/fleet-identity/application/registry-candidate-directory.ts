import type { CandidateDirectory, CandidateSnapshot, AircraftCandidate,
  CorrelationInput } from '../../aircraft-correlation/public/index.ts';
import type { IdentityReader } from '../ports/identity-reader.ts';
import { epochMillis } from '../../../kernel/time/epoch-millis.ts';

export interface RegistryCandidateDirectory extends CandidateDirectory {
  find(input: CorrelationInput): Promise<CandidateSnapshot & { readonly registryRevision: number }>;
}

export function createRegistryCandidateDirectory(reader: IdentityReader): RegistryCandidateDirectory {
  return { async find(input) {
    const snapshot = await reader.find(input.identifiers, input.effectiveAt);
    const byId = new Map<string, { aircraftId: AircraftCandidate['aircraftId']; aliases: AircraftCandidate['aliases'][number][] }>();
    for (const assertion of snapshot.assertions) {
      const existing = byId.get(assertion.aircraftId);
      const from = epochMillis(assertion.validFrom);
      const until = assertion.validUntil === null ? null : epochMillis(assertion.validUntil);
      if (!from.ok || (until !== null && !until.ok)) throw new Error('Invalid stored alias validity.');
      const candidate = existing ?? { aircraftId: assertion.aircraftId, aliases: [] };
      candidate.aliases.push({ identifier: assertion.identifier,
        validFrom: from.value, validUntil: until?.value ?? null });
      if (!existing) byId.set(assertion.aircraftId, candidate);
    }
    return snapshot.completeness === 'COMPLETE'
      ? { revision: `fleet/${snapshot.revision}`, registryRevision: snapshot.revision,
        completeness: 'COMPLETE', candidates: [...byId.values()] }
      : { revision: `fleet/${snapshot.revision}`, registryRevision: snapshot.revision,
        completeness: 'PARTIAL', reason: 'LIMIT_REACHED', candidates: [...byId.values()] };
  } };
}
