import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizeSourceObservation } from '../src/modules/source-connectors/public/index.ts';
import { evidenceDigest } from '../src/modules/source-connectors/infrastructure/airframes/decode-payload.ts';
import { normalizeRenderedDelivery } from '../src/modules/source-connectors/infrastructure/airframes/normalize-rendered-delivery.ts';
import { pageUrl, validateWindow } from '../src/modules/source-connectors/infrastructure/airframes/page-window.ts';
const fixture = (name, kind = 'valid') => JSON.parse(readFileSync(new URL(`./fixtures/airframes/${kind}/${name}.json`, import.meta.url)));
export const capability = { revision: 1, supportedDataLevels: ['PROVIDER_MESSAGE', 'RECEPTION', 'FRAME'],
  coverage: { kind: 'UNKNOWN' }, receiverCoverageCompleteness: 'UNKNOWN', sampling: { kind: 'NOT_DECLARED' },
  messageDirection: 'UNKNOWN', bearer: null, protocolStack: [] };
export const context = { sourceId: 'src_synthetic', provider: 'airframes', accountScope: 'synthetic', sourceEpoch: 'v1',
  ingestedAt: { at: '2026-11-19T10:01:00Z', basis: 'INGESTED', precision: 'SECOND', uncertaintyMs: 500 } };
const normalize = raw => normalizeSourceObservation(raw, { ...context, payloadDigest: evidenceDigest(raw) }, capability);
const value = raw => { const result = normalize(raw); assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

test('golden levels preserve immutable provenance and serialize without changing facts', () => {
  for (const name of ['message', 'reception', 'frame']) {
    const raw = fixture(name), result = value(raw);
    assert.equal(result.observation.dataLevel, raw.dataLevel);
    assert.equal(result.provenance.originalSourceId, raw.originalSourceId);
    assert.equal(result.provenance.deliveryId, raw.deliveryId);
    assert.equal(result.provenance.decoder.name, raw.decoder.name);
    assert.equal(result.provenance.receiverReceivedAt.iso, '2026-11-19T10:00:01.000Z');
    assert.equal(result.provenance.providerPublishedAt.iso, '2026-11-19T10:00:02.000Z');
    assert.equal(result.provenance.sourceObservedAt.uncertaintyMs, 500);
    assert.equal(result.aircraftHints.registration, 'N-TEST');
    assert.deepEqual(result.provenance.originalRegistrations, { aircraft: 'n-test' });
    assert.equal(result.aircraftRole, 'ORIGINATOR');
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
    assert.deepEqual(value(JSON.parse(JSON.stringify(raw))), result);
    assert.deepEqual(value(Object.fromEntries(Object.entries(raw).reverse())), result);
    raw.decoder.version = 'mutated'; raw.aircraft.icao24 = 'FFFFFF';
    raw.aircraft.registration = 'N-CHANGED';
    assert.equal(result.provenance.originalRegistrations.aircraft, 'n-test');
    assert.throws(() => { result.provenance.originalRegistrations.aircraft = 'changed'; }, TypeError);
    assert.equal(result.provenance.decoder.version, '1');
    assert.equal(result.aircraftHints.icao24, 'ABC123');
    assert.throws(() => { result.provenance.decoder.version = 'mutated'; }, TypeError);
    if (name === 'message') {
      assert.equal('receiverId' in result.observation, false);
      assert.equal('frameBytesBase64' in result.observation, false);
    }
  }
});
for (const [name, code] of [['unknown-version', 'UNKNOWN_SCHEMA'], ['missing-time', 'UNTRUSTED_TIME'], ['extra-field', 'INVALID_INPUT']]) {
  test(`rejects golden ${name} with a safe typed error`, () => {
    const result = normalize(fixture(name, 'invalid'));
    assert.equal(result.ok, false); assert.equal(result.error.code, code);
    assert.deepEqual(Object.keys(result.error).sort(), ['code', 'field', 'schemaVersion']);
    assert.doesNotMatch(JSON.stringify(result), /Synthetic example only/);
  });
}
test('time evidence rejects missing uncertainty, invalid UTC, impossible skew and never uses ingestion as receipt', () => {
  for (const at of ['not-time', '2026-02-30T10:00:00Z', '2026-11-19T10:00:00+01:00', '2026-11-20T10:00:00Z']) {
    const raw = fixture('message'); raw.receiverReceivedAt.at = at;
    assert.equal(normalize(raw).error.code, 'UNTRUSTED_TIME');
  }
  const raw = fixture('message'); delete raw.receiverReceivedAt.uncertaintyMs;
  assert.equal(normalize(raw).error.code, 'UNTRUSTED_TIME');
  const overlap = fixture('message'); overlap.sourceObservedAt.at = '2026-11-19T10:00:02Z';
  assert.equal(normalize(overlap).ok, true);
  overlap.sourceObservedAt.at = '2026-11-19T10:00:03Z';
  assert.equal(normalize(overlap).error.code, 'UNTRUSTED_TIME');
});
test('protocol classification retains unknown evidence and does not infer ACARS from VDL2', () => {
  const raw = fixture('message'); delete raw.applicationProtocol;
  assert.equal(value(raw).observation.protocolStack, undefined);
  raw.applicationProtocol = 'FUTURE_PROTOCOL'; raw.bearer = 'FUTURE_BEARER';
  const result = value(raw);
  assert.equal(result.bearer, 'UNKNOWN'); assert.equal(result.applicationProtocol, 'UNKNOWN');
  assert.equal(result.provenance.applicationProtocolLabel, 'FUTURE_PROTOCOL');
});
test('uplink aircraft is addressee; conflicts and inappropriate participant roles fail', () => {
  const raw = fixture('message'); raw.direction = 'UPLINK'; raw.addressee = raw.originator; delete raw.originator;
  assert.equal(value(raw).aircraftRole, 'ADDRESSEE');
  raw.addressee = { icao24: 'DEF456' };
  assert.equal(normalize(raw).error.code, 'CONFLICTING_HINTS');
  raw.addressee = { icao24: 'ABC123' }; raw.originator = { icao24: 'ABC123' };
  assert.equal(normalize(raw).error.code, 'CONFLICTING_HINTS');
});
test('optional fields stay absent and identical text with independent source IDs remains independent', () => {
  const raw = fixture('message');
  for (const key of ['aircraft', 'originator', 'direction', 'bearer', 'applicationProtocol', 'feeder', 'sourceObservedAt']) delete raw[key];
  const first = value(raw);
  assert.deepEqual(first.provenance.originalRegistrations, {});
  assert.deepEqual(first.aircraftHints, {}); assert.equal(first.observation.observedAt, undefined);
  assert.equal(first.aircraftRole, 'UNKNOWN');
  raw.deliveryId = 'synthetic-delivery-2'; raw.originalSourceId = 'synthetic-message-2';
  raw.receiverReceivedAt.at = '2026-11-19T10:00:02Z';
  const second = value(raw);
  assert.notEqual(first.observation.sourceDeliveryId.externalId, second.observation.sourceDeliveryId.externalId);
  assert.notEqual(first.observation.payloadDigest, second.observation.payloadDigest);
});
test('invalid fields, unsupported level and fabricated mixed data fail', () => {
  for (const change of [{ text: 42 }, { direction: 'SIDEWAYS' }, { dataLevel: 'OTHER' },
    { receiverId: 'fake-station' }, { frameBytesBase64: 'AQID' }, { aircraft: { icao24: 'no' } },
    { aircraft: { registration: '?' } }, { aircraft: { callsign: 'not a callsign' } }, { decoder: { name: 'missing-version' } }]) {
    assert.equal(normalize({ ...fixture('message'), ...change }).ok, false);
  }
  assert.equal(normalizeSourceObservation(fixture('frame'), { ...context, payloadDigest: 'a'.repeat(64) },
    { ...capability, supportedDataLevels: ['PROVIDER_MESSAGE'] }).error.code, 'CAPABILITY_MISMATCH');
});
test('rendered delivery maps only displayed evidence; a feeder never creates a reception', () => {
  const delivery = { source: pageUrl, retrievedAt: Date.parse('2026-11-19T10:01:00Z'), raw: {
    icao: 'ABC123', messagePath: '/messages/synthetic-1', text: 'Synthetic only', station: 'Synthetic feeder',
    evidence: { receiverReceivedAt: '2026-11-19T10:00:00Z', uncertaintyMs: '500', registration: 'n-test',
      callsign: 'test123', direction: 'UPLINK', bearer: 'VDL2' } } };
  const result = normalizeRenderedDelivery(delivery, context, capability);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.observation.dataLevel, 'PROVIDER_MESSAGE');
  assert.equal(result.value.provenance.feeder, 'Synthetic feeder');
  assert.equal(result.value.provenance.retrievedAt, delivery.retrievedAt);
  assert.equal(result.value.aircraftRole, 'ADDRESSEE');
  assert.equal(result.value.aircraftHints.registration, 'N-TEST');
  assert.equal(result.value.provenance.originalRegistrations.aircraft, 'n-test');
  assert.deepEqual(JSON.parse(JSON.stringify(result.value)), result.value);
  delivery.raw.evidence.registration = 'N-CHANGED';
  assert.equal(result.value.provenance.originalRegistrations.aircraft, 'n-test');
  delete delivery.raw.evidence.receiverReceivedAt;
  assert.equal(normalizeRenderedDelivery(delivery, context, capability).error.code, 'UNTRUSTED_TIME');
  delivery.raw.evidence.unrecognized = 'extra';
  assert.equal(normalizeRenderedDelivery(delivery, context, capability).error.code, 'INVALID_INPUT');
  assert.equal(validateWindow({ status: 'PARTIAL_LAYOUT', source: pageUrl, icao: 'ABC123', messages: [] }, 'ABC123', 1), 'INVALID_ENVELOPE');
  assert.deepEqual(validateWindow({ status: 'NO_OBSERVATIONS_COVERAGE_UNKNOWN', source: pageUrl, icao: 'ABC123', messages: [] }, 'ABC123', 1), []);
});

test('reception and frame paths require their supplied evidence and validate station scope', () => {
  const reception = fixture('reception'); delete reception.receiverId;
  assert.equal(normalize(reception).ok, false);
  const frame = fixture('frame'); delete frame.frameBytesBase64;
  assert.equal(normalize(frame).ok, false);
  frame.frameBytesBase64 = 'not-base64';
  assert.equal(normalize(frame).ok, false);
  const scoped = { ...capability, coverage: { kind: 'STATION_SCOPED', receiverIds: ['other-synthetic-receiver'] },
    receiverCoverageCompleteness: 'COMPLETE' };
  assert.equal(normalizeSourceObservation(fixture('reception'), { ...context, payloadDigest: 'a'.repeat(64) }, scoped)
    .error.code, 'CAPABILITY_MISMATCH');
});

test('rendered timestamps retain fractional precision across all source clocks', () => {
  for (const [suffix, canonical, precision] of [
    ['Z', '.000Z', 'SECOND'], ['.1Z', '.100Z', 'MILLISECOND'],
    ['.12Z', '.120Z', 'MILLISECOND'], ['.123Z', '.123Z', 'MILLISECOND'],
  ]) {
    const at = `2026-11-19T10:00:00${suffix}`;
    const delivery = { source: pageUrl, retrievedAt: Date.parse('2026-11-19T10:01:00Z'), raw: {
      icao: 'ABC123', messagePath: '/messages/synthetic-fraction', text: 'Synthetic only', station: null,
      evidence: { receiverReceivedAt: at, sourceObservedAt: at, providerPublishedAt: at, uncertaintyMs: '500' },
    } };
    const result = normalizeRenderedDelivery(delivery, context, capability);
    assert.equal(result.ok, true, JSON.stringify(result));
    for (const key of ['receiverReceivedAt', 'sourceObservedAt', 'providerPublishedAt']) {
      assert.equal(result.value.provenance[key].iso, `2026-11-19T10:00:00${canonical}`);
      assert.equal(result.value.provenance[key].precision, precision);
      assert.equal(result.value.provenance[key].uncertaintyMs, 500);
    }
    assert.equal(result.value.observation.receivedAt.precision, precision);
    assert.equal(result.value.observation.observedAt.precision, precision);
    assert.deepEqual(JSON.parse(JSON.stringify(result.value)), result.value);
    delivery.raw.evidence.receiverReceivedAt = '2026-11-19T10:00:00.1234Z';
    assert.equal(normalizeRenderedDelivery(delivery, context, capability).error.code, 'UNTRUSTED_TIME');
  }
});

test('publication-only receipt retains its basis without creating an observation clock', () => {
  const raw = fixture('message'); delete raw.receiverReceivedAt; delete raw.sourceObservedAt;
  const result = value(raw);
  assert.equal(result.observation.receivedAt.basis, 'PROVIDER');
  assert.equal(result.observation.observedAt, undefined);
  assert.equal(result.provenance.receiverReceivedAt, undefined);
  assert.equal(result.provenance.ingestedAt.basis, 'INGESTED');
});

test('a wide receiver interval cannot hide observation after provider publication', () => {
  const raw = fixture('message');
  raw.sourceObservedAt.at = '2026-11-19T10:00:10Z';
  raw.receiverReceivedAt.uncertaintyMs = 20000;
  assert.equal(normalize(raw).error.code, 'UNTRUSTED_TIME');
});

for (const [direction, participant] of [['UPLINK', 'addressee'], ['DOWNLINK', 'originator']]) {
  test(`original registration evidence retains each supplied ${participant} spelling`, () => {
    const raw = fixture('message');
    delete raw.originator;
    raw.direction = direction;
    raw[participant] = { registration: 'N-Test' };
    const result = value(raw);
    assert.deepEqual(result.provenance.originalRegistrations, { aircraft: 'n-test', [participant]: 'N-Test' });
    assert.equal(result.aircraftHints.registration, 'N-TEST');
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
    raw[participant].registration = 'N-OTHER';
    assert.equal(result.provenance.originalRegistrations[participant], 'N-Test');
    assert.throws(() => { result.provenance.originalRegistrations[participant] = 'N-OTHER'; }, TypeError);
    assert.equal(normalize(raw).error.code, 'CONFLICTING_HINTS');
  });
}
