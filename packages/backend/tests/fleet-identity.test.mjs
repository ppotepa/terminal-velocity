import test from 'node:test';
import assert from 'node:assert/strict';
import { icao24, registration, decideAircraftMatch } from '../src/modules/aircraft-correlation/public/index.ts';
import { resolveIdentityAt, validateIdentityAssertion, createRegistryCandidateDirectory, createResolveAircraft } from '../src/modules/fleet-identity/public/index.ts';

const hex = value => ({ kind: 'ICAO24', value: icao24(value).value });
const tail = value => ({ kind: 'REGISTRATION', value: registration(value).value });
const claim = (aircraftId, identifier, from, until = null) => ({
  assertionId: 1, aircraftId, identifier, validFrom: from, validUntil: until,
  recordedAt: '2026-11-20T00:00:00.000Z', supersededAt: null,
  sourceId: 'synthetic', issuer: 'test', revision: 1,
});

test('normalization validates registration, source and half-open validity', () => {
  const parsed = validateIdentityAssertion({ aircraftId: 'ac_a', identifier: tail(' n123ab '),
    validFrom: 0, validUntil: 10, sourceId: 'synthetic', issuer: 'test' });
  assert.equal(parsed.value.identifier.value, 'N123AB');
  assert.deepEqual(validateIdentityAssertion({ ...parsed.value, validUntil: 0 }).error,
    { code: 'INVALID_IDENTITY_ASSERTION', field: 'validity' });
  assert.deepEqual(validateIdentityAssertion({ ...parsed.value, sourceId: 'bad source' }).error,
    { code: 'INVALID_IDENTITY_ASSERTION', field: 'sourceId' });
  assert.deepEqual(validateIdentityAssertion({ ...parsed.value, issuer: undefined }).error,
    { code: 'INVALID_IDENTITY_ASSERTION', field: 'issuer' });
});

test('alias transfer resolves historical owner and exact boundary', () => {
  const assertions = [claim('ac_a', hex('a0b1c2'), 0, 100), claim('ac_b', hex('A0B1C2'), 100)];
  assert.equal(resolveIdentityAt([hex('A0B1C2')], 99, assertions, 2).aircraftId, 'ac_a');
  assert.equal(resolveIdentityAt([hex('A0B1C2')], 100, assertions, 2).aircraftId, 'ac_b');
});

test('overlapping claims and competing strong identifiers cannot confirm identity', () => {
  const assertions = [claim('ac_a', hex('A0B1C2'), 0), claim('ac_b', hex('A0B1C2'), 0),
    claim('ac_b', tail('N123AB'), 0)];
  assert.deepEqual(resolveIdentityAt([hex('A0B1C2')], 10, assertions, 3),
    { status: 'AMBIGUOUS', candidateIds: ['ac_a', 'ac_b'], revision: 3 });
  assert.deepEqual(resolveIdentityAt([hex('FFFFFF'), tail('N123AB')], 10, assertions, 3),
    { status: 'MATCHED', aircraftId: 'ac_b', revision: 3 });
  assert.equal(resolveIdentityAt([hex('A0B1C2')], 10, assertions, 3, false).status, 'INCOMPLETE');
  assert.deepEqual(resolveIdentityAt([hex('A0B1C2'), tail('N999ZZ')], 10,
    [...assertions, claim('ac_c', tail('N999ZZ'), 0)], 4),
  { status: 'AMBIGUOUS', candidateIds: ['ac_a', 'ac_b', 'ac_c'], revision: 4 });
  assert.deepEqual(resolveIdentityAt([hex('FFFFFF'), tail('N123AB'), tail('N999ZZ')], 10,
    [...assertions, claim('ac_c', tail('N999ZZ'), 0)], 4),
  { status: 'CONFLICTED', candidateIds: ['ac_b', 'ac_c'], revision: 4 });
});

test('a second simultaneous ICAO24 vetoes a position match until its validity ends', () => {
  const assertions = [claim('ac_a', hex('A0B1C2'), 0), claim('ac_a', hex('D00002'), 10, 20)];
  assert.deepEqual(resolveIdentityAt([hex('A0B1C2')], 10, assertions, 2),
    { status: 'CONFLICTED', candidateIds: ['ac_a'], revision: 2 });
  assert.equal(resolveIdentityAt([hex('A0B1C2')], 9, assertions, 2).status, 'MATCHED');
  assert.equal(resolveIdentityAt([hex('A0B1C2')], 20, assertions, 2).status, 'MATCHED');
});

test('registry lookup failure is explicitly incomplete while invalid input still fails validation', async () => {
  const resolve = createResolveAircraft({ async find() { throw new Error('database unavailable'); } });
  assert.deepEqual(await resolve([hex('A0B1C2')], 10),
    { status: 'INCOMPLETE', reason: 'LOOKUP_FAILED', revision: 0 });
  await assert.rejects(() => resolve([hex('A0B1C2')], -1), /Invalid observation time/);
});

test('registry candidate adapter preserves partial snapshots and correlation veto', async () => {
  const assertions = [claim('ac_a', hex('A0B1C2'), 0), claim('ac_b', hex('A0B1C2'), 0)];
  const input = { messageId: 'msg_synthetic', effectiveAt: 50, identifiers: [hex('A0B1C2')], callsign: null };
  const partial = createRegistryCandidateDirectory({ async find() {
    return { revision: 2, assertions: assertions.slice(0, 1), completeness: 'PARTIAL' };
  } });
  assert.equal((await partial.find(input)).completeness, 'PARTIAL');
  const full = createRegistryCandidateDirectory({ async find() {
    return { revision: 2, assertions, completeness: 'COMPLETE' };
  } });
  const snapshot = await full.find(input);
  assert.equal(snapshot.revision, 'fleet/2');
  assert.equal(decideAircraftMatch(input, snapshot.candidates).status, 'AMBIGUOUS');
  const failed = createRegistryCandidateDirectory({ async find() { throw new Error('lookup failed'); } });
  await assert.rejects(() => failed.find(input), /lookup failed/);
});
