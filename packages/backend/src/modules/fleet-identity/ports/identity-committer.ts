import type { IdentityAssertion, NewIdentityAssertion } from '../domain/identity-assertion.ts';
export interface IdentityCommitter {
  createAircraft(id: NewIdentityAssertion['aircraftId']): Promise<boolean>;
  append(input: NewIdentityAssertion, supersedesId?: number): Promise<IdentityAssertion>;
}
