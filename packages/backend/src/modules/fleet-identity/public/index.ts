export { validateIdentityAssertion, type IdentityAssertion, type NewIdentityAssertion } from '../domain/identity-assertion.ts';
export { resolveIdentityAt, type IdentityResolution } from '../domain/resolve-identity-at.ts';
export type { IdentityReader, IdentitySnapshot } from '../ports/identity-reader.ts';
export { createRegistryCandidateDirectory } from '../application/registry-candidate-directory.ts';
export { createResolveAircraft } from '../application/resolve-aircraft.ts';
export type { IdentityCommitter } from '../ports/identity-committer.ts';
export type { PositionLinker, PositionLinkDecision } from '../ports/position-linker.ts';
export type { ReplayRequestReader, IdentityReplayRequest } from '../ports/replay-request-reader.ts';
export { createPostgresRegistryReader, reevaluatePositionOnConnection, expandReplayAliases } from '../composition/postgres-registry.ts';
