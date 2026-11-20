import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePositionObservation,
  POSITION_OBSERVATION_SCHEMA_VERSION,
  acceptPositionObservation,
  classifyPositionFreshness,
  positionFreshnessPolicy,
  positionSourceId,
} from '../src/modules/flight-tracking/public/index.ts';
import { classifyAge } from '../src/modules/message-availability/domain/classify-age.ts';

const base = (overrides = {}) => ({
  schemaVersion: 1,
  sourceId: 'src_positions-test',
  sourceObservationId: 'delivery:position-1',
  observedAt: '2026-11-19T11:00:00Z',
  observedAtBasis: 'SOURCE_TIMESTAMP',
  ingestedAt: '2026-11-19T11:00:01.250Z',
  timestampPrecision: 'SECOND',
  timestampUncertaintyMs: 1000,
  measurementKind: 'ADS_B',
  latitude: 0,
  longitude: 0,
  identifierHints: { icao24: 'A0B1C2' },
  ...overrides,
});

const confirmedDecision = (overrides = {}) => ({
  status: 'CONFIRMED', sourceId: 'src_positions-test',
  sourceObservationId: 'delivery:position-1', aircraftId: 'ac_synthetic-1',
  icao24: 'A0B1C2', resolverId: 'resolver_synthetic', evidenceRef: 'decision:1', ...overrides,
});

test('v1 contract validates and normalizes an ADS-B observation with an aircraft address', () => {
  const parsed = parsePositionObservation(base());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.schemaVersion, POSITION_OBSERVATION_SCHEMA_VERSION);
  assert.equal(parsed.value.observedAt, '2026-11-19T11:00:00.000Z');
  assert.equal(parsed.value.ingestedAt, '2026-11-19T11:00:01.250Z');
  assert.equal(parsed.value.latitude, 0);
  assert.equal(parsed.value.longitude, 0);
  assert.equal(parsed.value.identifierHints.icao24, 'A0B1C2');
});

test('aircraft identity requires ICAO24 or an upstream confirmed stable aircraft ID', () => {
  const withoutHints = base();
  delete withoutHints.identifierHints;
  assert.deepEqual(parsePositionObservation(withoutHints).error, { code: 'UNRESOLVED_AIRCRAFT_IDENTITY' });
  assert.deepEqual(parsePositionObservation(base({ identifierHints: undefined })).error,
    { code: 'INVALID_IDENTIFIER_HINTS' });
  assert.deepEqual(parsePositionObservation(base({ identifierHints: { callsign: 'ABC123', sourceLocalId: 'track-1' } })).error,
    { code: 'UNRESOLVED_AIRCRAFT_IDENTITY' });
  assert.deepEqual(parsePositionObservation(base({ identifierHints: { callsign: 'ABC123' }, confirmedAircraftId: 'bad' })).error,
    { code: 'INVALID_POSITION_IDENTIFIER', field: 'confirmedAircraftId' });
  const confirmedInput = base({ identifierHints: { callsign: 'ABC123' }, confirmedAircraftId: 'ac_synthetic-1',
    identityEvidence: { resolverId: 'resolver_synthetic', evidenceRef: 'decision:1' } });
  assert.deepEqual(parsePositionObservation(confirmedInput).error, { code: 'UNSUPPORTED_CONFIRMED_IDENTITY' });
  const confirmed = parsePositionObservation(confirmedInput, confirmedDecision());
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.value.confirmedAircraftId, 'ac_synthetic-1');
  assert.deepEqual(parsePositionObservation(JSON.parse(JSON.stringify(confirmed.value)), confirmedDecision()).value,
    confirmed.value);
});

test('confirmed identity requires a matching upstream decision bound to this delivery', () => {
  const input = base({ confirmedAircraftId: 'ac_synthetic-1',
    identityEvidence: { resolverId: 'resolver_synthetic', evidenceRef: 'decision:1' } });
  assert.deepEqual(parsePositionObservation(input).error, { code: 'UNSUPPORTED_CONFIRMED_IDENTITY' });
  for (const decision of [
    confirmedDecision({ status: 'UNRESOLVED' }),
    confirmedDecision({ sourceId: 'src_other' }),
    confirmedDecision({ sourceObservationId: 'delivery:other' }),
    confirmedDecision({ aircraftId: 'ac_other' }),
    confirmedDecision({ resolverId: 'resolver_other' }),
    confirmedDecision({ evidenceRef: 'decision:other' }),
  ]) assert.deepEqual(parsePositionObservation(input, decision).error, { code: 'UNSUPPORTED_CONFIRMED_IDENTITY' });
  assert.deepEqual(parsePositionObservation(input, confirmedDecision({ icao24: 'FFFFFF' })).error,
    { code: 'CONFLICTING_POSITION_IDENTIFIERS' });
  assert.deepEqual(parsePositionObservation(input, confirmedDecision({ icao24: undefined })).error,
    { code: 'CONFLICTING_POSITION_IDENTIFIERS' });
  assert.deepEqual(parsePositionObservation(input, confirmedDecision({ icao24: 123 })).error,
    { code: 'CONFLICTING_POSITION_IDENTIFIERS' });
  assert.equal(parsePositionObservation(input, confirmedDecision()).ok, true);
  for (const identityEvidence of [undefined, { resolverId: 'resolver_synthetic' },
    { resolverId: '', evidenceRef: 'decision:1' },
    { resolverId: 'resolver_synthetic', evidenceRef: 'decision:other' }]) {
    assert.deepEqual(parsePositionObservation(base({ ...input, identityEvidence }), confirmedDecision()).error,
      { code: 'UNSUPPORTED_CONFIRMED_IDENTITY' });
  }
  assert.deepEqual(parsePositionObservation(base({ identityEvidence: { resolverId: 'resolver_synthetic', evidenceRef: 'decision:1' } })).error,
    { code: 'UNSUPPORTED_CONFIRMED_IDENTITY' });
});

test('coordinate bounds include both poles and the antimeridian but reject out-of-range and nonfinite values', () => {
  for (const [latitude, longitude] of [[-90, -180], [90, 180]])
    assert.equal(parsePositionObservation(base({ latitude, longitude })).ok, true);
  for (const [field, value] of [['latitude', -90.0001], ['latitude', 90.0001], ['longitude', -180.0001],
    ['longitude', 180.0001], ['latitude', Number.NaN], ['longitude', Number.POSITIVE_INFINITY]]) {
    const parsed = parsePositionObservation(base({ [field]: value }));
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, 'INVALID_COORDINATE');
    assert.equal(parsed.error.field, field);
  }
});

test('ADS-B and MLAT remain distinct and OTHER measurements require an explicit description', () => {
  assert.equal(parsePositionObservation(base({ measurementKind: 'ADS_B' })).value.measurementKind, 'ADS_B');
  assert.equal(parsePositionObservation(base({ measurementKind: 'MLAT' })).value.measurementKind, 'MLAT');
  assert.equal(parsePositionObservation(base({ measurementKind: 'OTHER' })).error.field, 'measurementDetail');
  assert.equal(parsePositionObservation(base({ measurementKind: 'OTHER', measurementDetail: 'provider-declared' })).ok,
    true);
  assert.equal(parsePositionObservation(base({ measurementKind: 'MLAT', measurementDetail: 'claimed' })).ok, false);
});

test('optional measurements preserve zero, explicit null, and omitted as separate values', () => {
  const zero = parsePositionObservation(base({ groundSpeedKnots: 0, trackDegrees: 0, trackKind: 'GROUND_TRACK',
    altitudes: [{ kind: 'BAROMETRIC_FT', valueFt: 0 }] }));
  assert.equal(zero.ok, true);
  assert.equal(zero.value.groundSpeedKnots, 0);
  assert.equal(zero.value.trackDegrees, 0);
  assert.deepEqual(zero.value.altitudes, [{ kind: 'BAROMETRIC_FT', valueFt: 0 }]);
  const unavailable = parsePositionObservation(base({ groundSpeedKnots: null, trackDegrees: null, altitudes: null }));
  assert.equal(unavailable.ok, true);
  assert.equal(unavailable.value.groundSpeedKnots, null);
  assert.equal(unavailable.value.trackDegrees, null);
  assert.equal(unavailable.value.altitudes, null);
  const absent = parsePositionObservation(base());
  assert.equal(absent.ok, true);
  assert.equal('groundSpeedKnots' in absent.value, false);
  assert.equal('trackDegrees' in absent.value, false);
  assert.equal('altitudes' in absent.value, false);
});

test('altitudes retain explicit feet and barometric/geometric distinctions', () => {
  for (const kind of ['BAROMETRIC_FT', 'GEOMETRIC_FT']) {
    const parsed = parsePositionObservation(base({ altitudes: [{ kind, valueFt: 12500 }] }));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.value.altitudes, [{ kind, valueFt: 12500 }]);
  }
  assert.deepEqual(parsePositionObservation(base({ altitudes: [{ kind: 'SURFACE', valueFt: null }] })).value.altitudes,
    [{ kind: 'SURFACE', valueFt: null }]);
  assert.equal(parsePositionObservation(base({ altitudes: [{ kind: 'SURFACE', valueFt: 0 }] })).ok, false);
  assert.equal(parsePositionObservation(base({ altitudes: [{ kind: 'METERS', value: 4000 }] })).ok, false);
  assert.equal(parsePositionObservation(base({ altitudes: [{ kind: 'BAROMETRIC_FT', valueFt: Number.NaN }] })).ok, false);
  const pair = parsePositionObservation(base({ altitudes: [
    { kind: 'BAROMETRIC_FT', valueFt: 12000 }, { kind: 'GEOMETRIC_FT', valueFt: 12100 },
  ] }));
  assert.equal(pair.ok, true);
  assert.deepEqual(parsePositionObservation(JSON.parse(JSON.stringify(pair.value))).value.altitudes, pair.value.altitudes);
  for (const altitudes of [[], [{ kind: 'BAROMETRIC_FT', valueFt: 1 }, { kind: 'BAROMETRIC_FT', valueFt: 2 }],
    [{ kind: 'SURFACE', valueFt: null }, { kind: 'GEOMETRIC_FT', valueFt: 1 }]])
    assert.deepEqual(parsePositionObservation(base({ altitudes })).error,
      { code: 'INVALID_POSITION_MEASUREMENT', field: 'altitude' });
});

test('timestamp parser rejects impossible, non-UTC and malformed calendar values', () => {
  for (const value of ['2026-02-30T11:00:00Z', '2026-11-19T11:00:00+01:00', 'not-a-time',
    '2026-11-19T11:00:00.1234Z']) {
    assert.equal(parsePositionObservation(base({ observedAt: value })).ok, false);
  }
  assert.equal(parsePositionObservation(base({ ingestedAt: '2026-02-30T11:00:00Z' })).ok, false);
});

test('future observations require sufficient declared timestamp uncertainty', () => {
  const ahead = '2026-11-19T11:00:02Z';
  assert.equal(parsePositionObservation(base({ observedAt: ahead, timestampUncertaintyMs: null })).error.code,
    'OBSERVATION_AFTER_INGESTION');
  assert.equal(parsePositionObservation(base({ observedAt: ahead, timestampUncertaintyMs: 749 })).error.code,
    'OBSERVATION_AFTER_INGESTION');
  assert.equal(parsePositionObservation(base({ observedAt: ahead, timestampUncertaintyMs: 750 })).ok, true);
});

test('delayed observations retain event time independently from later ingestion time', () => {
  const parsed = parsePositionObservation(base({ observedAt: '2026-11-19T10:00:00Z', ingestedAt: '2026-11-19T11:00:01Z' }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.observedAt, '2026-11-19T10:00:00.000Z');
  assert.equal(parsed.value.ingestedAt, '2026-11-19T11:00:01.000Z');
});

test('source age evidence preserves the reference instant and age used to derive event time', () => {
  const derived = parsePositionObservation(base({
    observedAt: '2026-11-19T11:00:00.750Z',
    observedAtBasis: 'SOURCE_AGE_FROM_REFERENCE',
    sourceTimeReferenceAt: '2026-11-19T11:00:01.250Z',
    sourceAgeSeconds: 0.5,
    ingestedAt: '2026-11-19T11:00:02Z',
  }));
  assert.equal(derived.ok, true);
  assert.equal(derived.value.sourceAgeSeconds, 0.5);
  assert.equal(derived.value.observedAtBasis, 'SOURCE_AGE_FROM_REFERENCE');
  assert.equal(parsePositionObservation(base({
    observedAtBasis: 'SOURCE_AGE_FROM_REFERENCE',
    sourceTimeReferenceAt: '2026-11-19T11:00:01.250Z',
    sourceAgeSeconds: 0.5,
  })).error.code, 'INVALID_POSITION_TIME');
  assert.equal(parsePositionObservation(base({ trackDegrees: 45 })).error.code, 'INVALID_POSITION_MEASUREMENT');
  assert.equal(parsePositionObservation(base({ trackDegrees: 45, trackKind: 'TRUE_HEADING' })).ok, true);
});

test('source age cannot conceal a reference time later than ingestion and declared uncertainty', () => {
  const evidence = {
    observedAt: '2026-11-19T10:00:00Z',
    observedAtBasis: 'SOURCE_AGE_FROM_REFERENCE',
    sourceTimeReferenceAt: '2026-11-19T12:00:00Z',
    sourceAgeSeconds: 7200,
    ingestedAt: '2026-11-19T11:00:00Z',
  };
  assert.deepEqual(parsePositionObservation(base({ ...evidence, timestampUncertaintyMs: 1000 })).error,
    { code: 'INVALID_POSITION_TIME', field: 'sourceTimeReferenceAt' });
  assert.deepEqual(parsePositionObservation(base({ ...evidence, timestampUncertaintyMs: null })).error,
    { code: 'INVALID_POSITION_TIME', field: 'sourceTimeReferenceAt' });
  assert.deepEqual(parsePositionObservation(base({ ...evidence, sourceTimeReferenceAt: 'not-a-time' })).error,
    { code: 'INVALID_POSITION_TIME', field: 'sourceTimeReferenceAt' });
  assert.equal(parsePositionObservation(base({ ...evidence, timestampUncertaintyMs: 3_600_000 })).ok, true);
});

test('identifier hints validate ICAO24 without claiming identity resolution', () => {
  const parsed = parsePositionObservation(base({ identifierHints: {
    icao24: 'a0b1c2', callsign: 'ABC123', sourceLocalId: 'track-1',
  } }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.identifierHints, { icao24: 'A0B1C2', callsign: 'ABC123', sourceLocalId: 'track-1' });
  assert.equal(parsePositionObservation(base({ identifierHints: { icao24: 'GG0000' } })).ok, false);
  assert.equal(parsePositionObservation(base({ identifierHints: {} })).ok, false);
  assert.deepEqual(parsePositionObservation(base({ identifierHints: { callsign: 'ABC123' } })).error,
    { code: 'UNRESOLVED_AIRCRAFT_IDENTITY' });
});

test('position quality retains provider-reported indicators and containment radius', () => {
  const parsed = parsePositionObservation(base({ quality: { nic: 0, nacP: 8, containmentRadiusMeters: 0 } }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.quality, { nic: 0, nacP: 8, containmentRadiusMeters: 0 });
  assert.deepEqual(parsePositionObservation(base({ quality: { nic: null, nacP: null,
    containmentRadiusMeters: null } })).value.quality,
  { nic: null, nacP: null, containmentRadiusMeters: null });
  assert.equal(parsePositionObservation(base({ quality: { nic: -1 } })).ok, false);
  assert.equal(parsePositionObservation(base({ quality: { containmentRadiusMeters: Number.NaN } })).ok, false);
});

test('unknown fields, unsupported versions, bad IDs, invalid units and invalid optional values fail explicitly', () => {
  assert.equal(parsePositionObservation(base({ schemaVersion: 2 })).error.code, 'UNSUPPORTED_VERSION');
  assert.equal(parsePositionObservation(base({ unexpected: true })).ok, false);
  assert.equal(parsePositionObservation(base({ sourceId: 'bad-source' })).ok, false);
  assert.equal(parsePositionObservation(base({ sourceObservationId: '  ' })).ok, false);
  assert.equal(parsePositionObservation(base({ groundSpeedKnots: -1 })).ok, false);
  assert.equal(parsePositionObservation(base({ trackDegrees: 360 })).ok, false);
  assert.equal(parsePositionObservation(base({ timestampUncertaintyMs: -1 })).ok, false);
  assert.equal(parsePositionObservation(base({ timestampUncertaintyMs: 31_536_000_001 })).ok, false);
  assert.equal(parsePositionObservation(base({ timestampPrecision: 'WEEK' })).ok, false);
});

test('untrusted accessors are rejected without invoking them and output values are immutable copies', () => {
  let invoked = false;
  const unsafe = base();
  Object.defineProperty(unsafe, 'latitude', { get() { invoked = true; return 1; }, enumerable: true });
  assert.equal(parsePositionObservation(unsafe).ok, false);
  assert.equal(invoked, false);
  const hints = { icao24: 'a0b1c2' };
  const parsed = parsePositionObservation(base({ identifierHints: hints }));
  assert.equal(parsed.ok, true);
  hints.icao24 = 'ffffff';
  assert.equal(parsed.value.identifierHints.icao24, 'A0B1C2');
  assert.equal(Object.isFrozen(parsed.value), true);
  assert.equal(Object.isFrozen(parsed.value.identifierHints), true);
});

test('adapter acceptance enforces canonical fields and configured source capabilities', () => {
  const sourceId = positionSourceId('src_positions-test').value;
  const capabilities = { sourceId, measurementKinds: ['ADS_B'], observedAtBases: ['SOURCE_TIMESTAMP'] };
  const adapter = { parse(raw, context) { return parsePositionObservation(raw, context.identityDecision); } };
  const context = { sourceId, ingestedAt: base().ingestedAt, capabilities };
  assert.equal(acceptPositionObservation(adapter, base(), context).ok, true);
  assert.deepEqual(acceptPositionObservation(adapter, base({ measurementKind: 'MLAT' }), context).error,
    { code: 'UNSUPPORTED_POSITION_CAPABILITY', field: 'measurementKind' });
  assert.deepEqual(acceptPositionObservation(adapter, base({ observedAtBasis: 'RECEIVER_TIMESTAMP' }), context).error,
    { code: 'UNSUPPORTED_POSITION_CAPABILITY', field: 'observedAtBasis' });
  assert.deepEqual(acceptPositionObservation(adapter, base(), { ...context, sourceId: positionSourceId('src_other').value }).error,
    { code: 'UNSUPPORTED_POSITION_CAPABILITY', field: 'sourceId' });
  const wrongSource = { parse() { return { ok: true, value: parsePositionObservation(base({ sourceId: 'src_other' })).value }; } };
  assert.deepEqual(acceptPositionObservation(wrongSource, null, context).error,
    { code: 'UNSUPPORTED_POSITION_CAPABILITY', field: 'sourceId' });
  const wrongIngestion = { parse() { return parsePositionObservation(base({ ingestedAt: '2026-11-19T11:00:02Z' })); } };
  assert.deepEqual(acceptPositionObservation(wrongIngestion, null, context).error,
    { code: 'INVALID_POSITION_TIME', field: 'ingestedAt' });
  assert.equal(acceptPositionObservation(adapter, base({ latitude: null }), context).error.code, 'INVALID_COORDINATE');
  const unidentified = base();
  delete unidentified.identifierHints;
  assert.deepEqual(acceptPositionObservation(adapter, unidentified, context).error,
    { code: 'UNRESOLVED_AIRCRAFT_IDENTITY' });
  assert.deepEqual(acceptPositionObservation(adapter, base(), { ...context, ingestedAt: 'invalid' }).error,
    { code: 'INVALID_POSITION_TIME', field: 'ingestedAt' });
  const claimed = base({ confirmedAircraftId: 'ac_synthetic-1',
    identityEvidence: { resolverId: 'resolver_synthetic', evidenceRef: 'decision:1' } });
  assert.deepEqual(acceptPositionObservation(adapter, claimed, context).error,
    { code: 'UNSUPPORTED_CONFIRMED_IDENTITY' });
  assert.deepEqual(acceptPositionObservation(adapter, claimed, {
    ...context, identityDecision: confirmedDecision({ icao24: 'FFFFFF' }),
  }).error, { code: 'CONFLICTING_POSITION_IDENTIFIERS' });
  assert.equal(acceptPositionObservation(adapter, claimed, {
    ...context, identityDecision: confirmedDecision(),
  }).ok, true);
  const forgedAdapter = { parse() { return { ok: true, value: claimed }; } };
  assert.deepEqual(acceptPositionObservation(forgedAdapter, null, context).error,
    { code: 'UNSUPPORTED_CONFIRMED_IDENTITY' });
});

test('canonical JSON roundtrip retains explicit null and does not invent omitted measurements', () => {
  const original = parsePositionObservation(base({ measurementKind: 'MLAT',
    altitudes: [{ kind: 'GEOMETRIC_FT', valueFt: 0 }], groundSpeedKnots: null }));
  assert.equal(original.ok, true);
  const replayed = parsePositionObservation(JSON.parse(JSON.stringify(original.value)));
  assert.equal(replayed.ok, true);
  assert.deepEqual(replayed.value, original.value);
  assert.equal('trackDegrees' in replayed.value, false);
  assert.equal(replayed.value.groundSpeedKnots, null);
});

test('position freshness uses observed time and uncertainty without refreshing message freshness', () => {
  const policy = positionFreshnessPolicy({ currentWithinMs: 60_000 }).value;
  const messagePolicy = { recentWithinMs: 60_000, staleWithinMs: 120_000 };
  const now = '2026-11-19T11:00:30Z';
  const radioBefore = classifyAge(null, Date.parse(now), messagePolicy);
  const recent = parsePositionObservation(base({ timestampUncertaintyMs: 1000 })).value;
  assert.equal(classifyPositionFreshness(recent, now, policy), 'CURRENT');
  assert.equal(classifyAge(null, Date.parse(now), messagePolicy), radioBefore);
  assert.equal(radioBefore, 'NONE');
  const backfill = parsePositionObservation(base({
    observedAt: '2026-11-19T10:00:00Z', ingestedAt: '2026-11-19T11:00:29Z',
  })).value;
  assert.equal(classifyPositionFreshness(backfill, now, policy), 'STALE');
  assert.equal(classifyPositionFreshness(parsePositionObservation(base({ timestampUncertaintyMs: null })).value,
    now, policy), 'UNKNOWN');
  assert.equal(classifyPositionFreshness(recent, '2026-11-19T11:00:59.500Z', policy), 'UNKNOWN');
  assert.equal(classifyPositionFreshness(recent, '2026-11-19T10:59:59Z', policy), 'UNKNOWN');
  assert.equal(classifyPositionFreshness(null, now, policy), 'UNKNOWN');
  const coarse = parsePositionObservation(base({ timestampPrecision: 'HOUR', timestampUncertaintyMs: 0 })).value;
  assert.equal(classifyPositionFreshness(coarse, now, policy), 'UNKNOWN');
  assert.equal(classifyPositionFreshness(parsePositionObservation(base({ timestampPrecision: 'UNKNOWN' })).value,
    now, policy), 'UNKNOWN');
  assert.deepEqual(positionFreshnessPolicy({ currentWithinMs: 0 }).error,
    { code: 'INVALID_POSITION_FRESHNESS_POLICY' });
});
