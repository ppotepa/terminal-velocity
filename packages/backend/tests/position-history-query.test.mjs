import test from 'node:test';
import assert from 'node:assert/strict';
import {
  positionHistoryByIcao24Query, positionHistoryWithinBoundsQuery,
  parsePositionObservation,
} from '../src/modules/flight-tracking/public/index.ts';

const window = { fromObservedAtMs: 1000, toObservedAtMs: 2000, limit: 2 };
test('history requires bounded time, page size and a valid keyset cursor', () => {
  assert.equal(positionHistoryByIcao24Query({ ...window, icao24Hint: 'a0b1c2' }).value.icao24Hint, 'A0B1C2');
  for (const input of [
    { ...window, icao24Hint: 'ZZZZZZ' },
    { ...window, icao24Hint: 'A0B1C2', limit: 501 },
    { ...window, icao24Hint: 'A0B1C2', toObservedAtMs: 1000 },
    { ...window, icao24Hint: 'A0B1C2', after: { observedAtMs: 2000, sourceId: 'src_a', sourceObservationId: 'one' } },
  ]) assert.equal(positionHistoryByIcao24Query(input).ok, false);
});

test('bounds accept antimeridian crossing and reject invalid or empty boxes', () => {
  assert.equal(positionHistoryWithinBoundsQuery({ ...window,
    bounds: { west: 179.9, east: -179.9, south: -1, north: 1 },
  }).ok, true);
  for (const bounds of [
    { west: 181, east: -179, south: -1, north: 1 },
    { west: 0, east: 0, south: -1, north: 1 },
    { west: 0, east: 1, south: 1, north: 1 },
  ]) assert.equal(positionHistoryWithinBoundsQuery({ ...window, bounds }).ok, false);
});

test('optional source delivery reference is validated and retained', () => {
  const base = { schemaVersion: 1, sourceId: 'src_synthetic-a', sourceObservationId: 'sample',
    observedAt: '2026-11-19T11:00:00Z', observedAtBasis: 'SOURCE_TIMESTAMP',
    ingestedAt: '2026-11-19T11:00:01Z', timestampPrecision: 'SECOND',
    timestampUncertaintyMs: 0, measurementKind: 'ADS_B', latitude: 0,
    longitude: 180, identifierHints: { icao24: 'A0B1C2' } };
  assert.equal(parsePositionObservation({ ...base, sourceDeliveryRef: 'delivery:sample' }).value.sourceDeliveryRef,
    'delivery:sample');
  assert.equal(parsePositionObservation({ ...base, sourceDeliveryRef: '../unsafe' }).ok, false);
});
