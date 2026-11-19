import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePositionObservation,
  POSITION_OBSERVATION_SCHEMA_VERSION,
} from '../src/modules/flight-tracking/public/index.ts';

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
  ...overrides,
});

test('v1 contract validates and normalizes an ADS-B observation without requiring aircraft identity', () => {
  const parsed = parsePositionObservation(base());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.schemaVersion, POSITION_OBSERVATION_SCHEMA_VERSION);
  assert.equal(parsed.value.observedAt, '2026-11-19T11:00:00.000Z');
  assert.equal(parsed.value.ingestedAt, '2026-11-19T11:00:01.250Z');
  assert.equal(parsed.value.latitude, 0);
  assert.equal(parsed.value.longitude, 0);
  assert.equal('identifierHints' in parsed.value, false);
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
    altitude: { kind: 'BAROMETRIC_FT', valueFt: 0 } }));
  assert.equal(zero.ok, true);
  assert.equal(zero.value.groundSpeedKnots, 0);
  assert.equal(zero.value.trackDegrees, 0);
  assert.deepEqual(zero.value.altitude, { kind: 'BAROMETRIC_FT', valueFt: 0 });
  const unavailable = parsePositionObservation(base({ groundSpeedKnots: null, trackDegrees: null, altitude: null }));
  assert.equal(unavailable.ok, true);
  assert.equal(unavailable.value.groundSpeedKnots, null);
  assert.equal(unavailable.value.trackDegrees, null);
  assert.equal(unavailable.value.altitude, null);
  const absent = parsePositionObservation(base());
  assert.equal(absent.ok, true);
  assert.equal('groundSpeedKnots' in absent.value, false);
  assert.equal('trackDegrees' in absent.value, false);
  assert.equal('altitude' in absent.value, false);
});

test('altitudes retain explicit feet and barometric/geometric distinctions', () => {
  for (const kind of ['BAROMETRIC_FT', 'GEOMETRIC_FT']) {
    const parsed = parsePositionObservation(base({ altitude: { kind, valueFt: 12500 } }));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.value.altitude, { kind, valueFt: 12500 });
  }
  assert.deepEqual(parsePositionObservation(base({ altitude: { kind: 'SURFACE', valueFt: null } })).value.altitude,
    { kind: 'SURFACE', valueFt: null });
  assert.equal(parsePositionObservation(base({ altitude: { kind: 'SURFACE', valueFt: 0 } })).ok, false);
  assert.equal(parsePositionObservation(base({ altitude: { kind: 'METERS', value: 4000 } })).ok, false);
  assert.equal(parsePositionObservation(base({ altitude: { kind: 'BAROMETRIC_FT', valueFt: Number.NaN } })).ok, false);
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

test('identifier hints validate ICAO24 without claiming identity resolution', () => {
  const parsed = parsePositionObservation(base({ identifierHints: {
    icao24: 'a0b1c2', callsign: 'ABC123', sourceLocalId: 'track-1',
  } }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.identifierHints, { icao24: 'A0B1C2', callsign: 'ABC123', sourceLocalId: 'track-1' });
  assert.equal(parsePositionObservation(base({ identifierHints: { icao24: 'GG0000' } })).ok, false);
  assert.equal(parsePositionObservation(base({ identifierHints: {} })).ok, false);
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
