import test from 'node:test';
import assert from 'node:assert/strict';
import {
  externalDeliveryId,
  observationTimeEvidence,
  parseSourceObservation,
  sourceCapabilities,
  sourceDeliveryIdentity,
  sourceId,
  sourceObservationContractParser,
} from '../src/modules/source-connectors/public/index.ts';

const received = (at = '2026-11-19T11:00:00Z', overrides = {}) => ({
  at,
  basis: 'RECEIVED',
  precision: 'MILLISECOND',
  uncertaintyMs: 0,
  ...overrides,
});

const observed = (at = '2026-11-19T10:59:59Z', overrides = {}) => ({
  at,
  basis: 'OBSERVED',
  precision: 'SECOND',
  uncertaintyMs: 500,
  ...overrides,
});

const base = (overrides = {}) => ({
  schemaVersion: 1,
  sourceId: 'src_test-feed',
  sourceDeliveryId: {
    provider: 'test-provider',
    accountScope: 'account-1',
    sourceEpoch: 'epoch-1',
    externalId: 'delivery-1',
  },
  receivedAt: received(),
  observedAt: observed(),
  payloadDigest: 'a'.repeat(64),
  capabilitiesRevision: 1,
  ...overrides,
});

const providerMessage = (overrides = {}) => ({
  ...base(),
  dataLevel: 'PROVIDER_MESSAGE',
  decodedText: 'Synthetic test content',
  ...overrides,
});

test('source and external delivery identifiers are validated without rewriting opaque IDs', () => {
  assert.equal(sourceId('src_feed-1').ok, true);
  assert.equal(sourceId('feed-1').ok, false);
  assert.equal(externalDeliveryId('provider/id:42').value, 'provider/id:42');
  assert.equal(externalDeliveryId('  ').ok, false);
});

test('delivery identity scopes external IDs by provider, account and source epoch', () => {
  const first = sourceDeliveryIdentity({
    provider: 'Provider-A', accountScope: 'tenant-1', sourceEpoch: 'restart-1', externalId: 'same-id',
  });
  const second = sourceDeliveryIdentity({
    provider: 'provider-a', accountScope: 'tenant-1', sourceEpoch: 'restart-2', externalId: 'same-id',
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notDeepEqual(first.value, second.value);
  assert.equal(sourceDeliveryIdentity({
    provider: 'provider-a', accountScope: '', sourceEpoch: 'restart-1', externalId: 'same-id',
  }).ok, false);
});

test('time evidence requires a valid UTC instant and distinguishes zero uncertainty from absence', () => {
  assert.equal(observationTimeEvidence(received()).value.uncertaintyMs, 0);
  for (const at of ['2026-02-30T12:00:00Z', '2026-11-19T11:00:00+01:00', '2026-11-19'])
    assert.equal(observationTimeEvidence(received(at)).ok, false);
  assert.equal(observationTimeEvidence({ ...received(), uncertaintyMs: undefined }).ok, false);
  assert.equal(observationTimeEvidence({ ...received(), uncertaintyMs: -1 }).ok, false);
  assert.equal(observationTimeEvidence({ ...received(), precision: 'FORTNIGHT' }).ok, false);
});

test('a provider-message observation needs no receiver, frequency or RF frame', () => {
  const parsed = parseSourceObservation(providerMessage({
    addressHints: { icao24: 'a0b1c2', callsign: 'abc123' },
    bearer: 'VDL2',
    protocolStack: ['ACARS'],
    direction: 'UPLINK',
  }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.dataLevel, 'PROVIDER_MESSAGE');
  assert.equal(parsed.value.addressHints.icao24, 'A0B1C2');
  assert.equal(parsed.value.addressHints.callsign, 'ABC123');
  assert.equal('receiverId' in parsed.value, false);
  assert.equal('frequencyHz' in parsed.value, false);
  assert.equal('frameBytesBase64' in parsed.value, false);
});

test('provider-message input cannot smuggle fabricated receiver or frame metadata', () => {
  for (const extra of [
    { receiverId: 'invented-receiver' },
    { frequencyHz: 131_550_000 },
    { frameBytesBase64: 'AQID' },
  ]) {
    assert.equal(parseSourceObservation(providerMessage(extra)).ok, false);
  }
});

test('reception and frame variants require evidence at their own observation level', () => {
  const reception = parseSourceObservation({
    ...base(), dataLevel: 'RECEPTION', receiverId: 'receiver-17', frequencyHz: 131_550_000,
  });
  const frame = parseSourceObservation({
    ...base(), dataLevel: 'FRAME', frameBytesBase64: 'AQID', bearer: 'VDL2',
  });
  assert.equal(reception.ok, true);
  assert.equal(reception.value.dataLevel, 'RECEPTION');
  assert.equal(reception.value.receiverId, 'receiver-17');
  assert.equal(frame.ok, true);
  assert.equal(frame.value.dataLevel, 'FRAME');
  assert.equal(frame.value.frameBytesBase64, 'AQID');
  assert.equal(parseSourceObservation({ ...base(), dataLevel: 'RECEPTION' }).error.code, 'MISSING_REQUIRED_EVIDENCE');
  assert.equal(parseSourceObservation({ ...base(), dataLevel: 'FRAME' }).error.code, 'MISSING_REQUIRED_EVIDENCE');
  assert.equal(parseSourceObservation({
    ...base(), dataLevel: 'FRAME', frameBytesBase64: 'not-base64',
  }).ok, false);
  assert.equal(parseSourceObservation({
    ...base(), dataLevel: 'FRAME', frameBytesBase64: 'AB==',
  }).ok, false);
});

test('separate source deliveries remain distinct even when their decoded content matches', () => {
  const first = parseSourceObservation(providerMessage({
    sourceDeliveryId: { ...base().sourceDeliveryId, externalId: 'delivery-a' },
  }));
  const second = parseSourceObservation(providerMessage({
    sourceDeliveryId: { ...base().sourceDeliveryId, externalId: 'delivery-b' },
  }));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.value.decodedText, second.value.decodedText);
  assert.notEqual(first.value.sourceDeliveryId.externalId, second.value.sourceDeliveryId.externalId);
});

test('invalid ICAO hints, timestamps, clock bases and impossible future observations are rejected', () => {
  assert.equal(parseSourceObservation(providerMessage({ addressHints: { icao24: 'GG0000' } })).ok, false);
  assert.equal(parseSourceObservation(providerMessage({ receivedAt: received('2026-11-19T11:00:00+01:00') })).ok, false);
  assert.equal(parseSourceObservation(providerMessage({ receivedAt: received(undefined, { basis: 'OBSERVED' }) })).error.code,
    'CONFLICTING_TIME_EVIDENCE');
  assert.equal(parseSourceObservation(providerMessage({
    observedAt: observed('2026-11-19T11:00:02Z', { uncertaintyMs: 0 }),
  })).error.code, 'FUTURE_OBSERVATION');
  assert.equal(parseSourceObservation(providerMessage({
    observedAt: observed('2026-11-19T11:00:02Z', { uncertaintyMs: 3_000 }),
  })).ok, true);
});

test('missing time, unknown schema versions and unsupported observation levels return typed errors', () => {
  const { receivedAt: _receivedAt, ...withoutTime } = providerMessage();
  assert.equal(parseSourceObservation(withoutTime).error.code, 'MISSING_TIME');
  const { schemaVersion: _schemaVersion, ...withoutVersion } = providerMessage();
  assert.equal(parseSourceObservation(withoutVersion).error.code, 'INVALID_INPUT');
  assert.equal(parseSourceObservation(providerMessage({ schemaVersion: 2 })).error.code, 'UNSUPPORTED_VERSION');
  assert.equal(parseSourceObservation(providerMessage({ dataLevel: 'TRANSMISSION' })).error.code, 'UNSUPPORTED_LEVEL');
  assert.equal(parseSourceObservation(base({ dataLevel: 'PROVIDER_MESSAGE' })).error.code, 'MISSING_REQUIRED_EVIDENCE');
  assert.equal(parseSourceObservation(providerMessage({ capabilitiesRevision: 0 })).error.code, 'INVALID_INPUT');
});

test('untrusted accessors and unknown fields are rejected without running getters', () => {
  let invoked = false;
  const input = providerMessage();
  Object.defineProperty(input, 'decodedText', { get() { invoked = true; return 'unsafe'; }, enumerable: true });
  assert.equal(parseSourceObservation(input).ok, false);
  assert.equal(invoked, false);
  assert.equal(parseSourceObservation(providerMessage({ publicEligible: true })).ok, false);
});

test('returned observations and nested evidence are immutable copies', () => {
  const stack = ['ACARS'];
  const input = providerMessage({ protocolStack: stack });
  const parsed = parseSourceObservation(input);
  assert.equal(parsed.ok, true);
  stack.push('MUTATED');
  assert.deepEqual(parsed.value.protocolStack, ['ACARS']);
  assert.equal(Object.isFrozen(parsed.value), true);
  assert.equal(Object.isFrozen(parsed.value.sourceDeliveryId), true);
  assert.equal(Object.isFrozen(parsed.value.protocolStack), true);
});

test('source capabilities validate levels, coverage and sampling independently', () => {
  const capabilities = sourceCapabilities({
    revision: 1,
    supportedDataLevels: ['PROVIDER_MESSAGE', 'RECEPTION'],
    coverage: { kind: 'STATION_SCOPED', receiverIds: ['receiver-17'] },
    receiverCoverageCompleteness: 'COMPLETE',
    sampling: { kind: 'SAMPLED', method: 'provider declares 1 in 4', fraction: 0.25 },
    messageDirection: 'UNKNOWN',
    bearer: 'VDL2',
    protocolStack: ['ACARS'],
  });
  assert.equal(capabilities.ok, true);
  assert.equal(capabilities.value.coverage.kind, 'STATION_SCOPED');
  assert.equal(capabilities.value.sampling.kind, 'SAMPLED');
  assert.equal(capabilities.value.bearer, 'VDL2');
  assert.deepEqual(capabilities.value.protocolStack, ['ACARS']);
  assert.equal(sourceCapabilities({
    revision: 1, supportedDataLevels: ['PROVIDER_MESSAGE'], coverage: { kind: 'UNKNOWN' },
    receiverCoverageCompleteness: 'UNKNOWN',
    sampling: { kind: 'SAMPLED', method: 'declared', fraction: 1.1 }, messageDirection: 'UNKNOWN',
    bearer: null, protocolStack: [],
  }).ok, false);
  assert.equal(sourceCapabilities({
    revision: 1, supportedDataLevels: ['PROVIDER_MESSAGE', 'PROVIDER_MESSAGE'], coverage: { kind: 'UNKNOWN' },
    receiverCoverageCompleteness: 'UNKNOWN',
    sampling: { kind: 'NOT_DECLARED' }, messageDirection: 'UNKNOWN', bearer: null, protocolStack: [],
  }).ok, false);
  assert.equal(sourceCapabilities({
    revision: 1, supportedDataLevels: ['PROVIDER_MESSAGE'], coverage: { kind: 'UNKNOWN' },
    receiverCoverageCompleteness: 'COMPLETE', sampling: { kind: 'NOT_DECLARED' },
    messageDirection: 'UNKNOWN', bearer: null, protocolStack: [],
  }).ok, false);
  assert.equal(sourceCapabilities({
    revision: 1, supportedDataLevels: ['PROVIDER_MESSAGE'], coverage: { kind: 'UNKNOWN' },
    receiverCoverageCompleteness: 'UNKNOWN', sampling: { kind: 'SAMPLED', method: 'declared', fraction: undefined },
    messageDirection: 'UNKNOWN', bearer: null, protocolStack: [],
  }).ok, false);
});

test('the exported contract parser accepts unknown input and preserves typed failures', () => {
  assert.equal(sourceObservationContractParser.parse(providerMessage()).ok, true);
  assert.equal(sourceObservationContractParser.parse({}).error.code, 'INVALID_INPUT');
});
