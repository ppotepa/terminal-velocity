import { aircraftId, type AircraftId } from '../../../contracts/identity/aircraft-id.ts';
import { icao24, registration, type StrongIdentifier } from '../../../contracts/identity/aircraft-alias.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';

export interface IdentityAssertion {
  readonly assertionId: number;
  readonly aircraftId: AircraftId;
  readonly identifier: StrongIdentifier;
  readonly validFrom: number;
  readonly validUntil: number | null;
  readonly recordedAt: string;
  readonly supersededAt: string | null;
  readonly sourceId: string;
  readonly issuer: string;
  readonly revision: number;
}

export type NewIdentityAssertion = Pick<IdentityAssertion,
  'aircraftId' | 'identifier' | 'validFrom' | 'validUntil' | 'sourceId' | 'issuer'>;

export function validateIdentityAssertion(input: NewIdentityAssertion):
  Result<NewIdentityAssertion, { readonly code: 'INVALID_IDENTITY_ASSERTION'; readonly field: string }> {
  if (!input || typeof input.aircraftId !== 'string' || !aircraftId(input.aircraftId).ok)
    return err({ code: 'INVALID_IDENTITY_ASSERTION', field: 'aircraftId' });
  if (input.identifier?.kind !== 'ICAO24' && input.identifier?.kind !== 'REGISTRATION')
    return err({ code: 'INVALID_IDENTITY_ASSERTION', field: 'identifier' });
  if (typeof input.identifier.value !== 'string')
    return err({ code: 'INVALID_IDENTITY_ASSERTION', field: 'identifier' });
  const parsed = input.identifier.kind === 'ICAO24'
    ? icao24(input.identifier.value) : registration(input.identifier.value);
  if (!parsed.ok) return err({ code: 'INVALID_IDENTITY_ASSERTION', field: 'identifier' });
  if (!Number.isSafeInteger(input.validFrom) || input.validFrom < 0 ||
    (input.validUntil !== null && (!Number.isSafeInteger(input.validUntil) || input.validUntil <= input.validFrom)))
    return err({ code: 'INVALID_IDENTITY_ASSERTION', field: 'validity' });
  if (typeof input.sourceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.sourceId))
    return err({ code: 'INVALID_IDENTITY_ASSERTION', field: 'sourceId' });
  if (typeof input.issuer !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.issuer))
    return err({ code: 'INVALID_IDENTITY_ASSERTION', field: 'issuer' });
  return ok({ ...input, identifier: { kind: input.identifier.kind, value: parsed.value } as StrongIdentifier });
}
