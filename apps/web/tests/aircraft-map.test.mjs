import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedBbox } from '../src/features/aircraft-map/viewport-bounds.ts';
import { uniqueAircraft, markerStatus } from '../src/features/aircraft-map/markers.ts';
import { decodeTrackPage, trackGeoJson } from '../src/features/aircraft-map/observed-track.ts';

const aircraft = id => ({ aircraftId: id, position: { latitude: 52, longitude: 21 },
  messages: { freshness: 'NONE' } });

test('viewport bounds stay within API limits and preserve antimeridian crossing', () => {
  assert.equal(boundedBbox(170, -10, 190, 10), '170,-10,-170,10');
  const [west, south, east, north] = boundedBbox(-150, -80, 150, 80).split(',').map(Number);
  assert.ok(east - west <= 90);
  assert.ok(north - south <= 60);
  assert.throws(() => boundedBbox(NaN, 0, 1, 1), RangeError);
});

test('aircraft identity is stable and status is based on message freshness', () => {
  assert.deepEqual(uniqueAircraft([aircraft('ac_b'), aircraft('ac_a'), aircraft('ac_b')])
    .map(item => item.aircraftId), ['ac_a', 'ac_b']);
  assert.equal(markerStatus(aircraft('ac_a')).label, 'No recent message');
  assert.equal(markerStatus({ ...aircraft('ac_a'), messages: { freshness: 'RECENT' } }).label,
    'Recent message');
});

test('observed track renders separate segments and rejects invented or oversized geometry', () => {
  const point = (latitude, longitude, observedAtMs) => ({ latitude, longitude, observedAtMs });
  const wire = { data: { aircraftId: 'ac_a', observedCount: 4, hasMore: false,
    segments: [
      { breakBefore: null, continuesPrevious: false, points: [point(51, 20, 1), point(52, 21, 2)] },
      { breakBefore: 'TIME_GAP', continuesPrevious: false, points: [point(53, 22, 3), point(54, 23, 4)] },
    ] } };
  const page = decodeTrackPage(wire, 'ac_a');
  assert.equal(trackGeoJson(page).features.length, 2);
  assert.deepEqual(trackGeoJson(page).features[1].geometry.coordinates,
    [[22,53],[23,54]]);
  assert.throws(() => decodeTrackPage(wire, 'ac_b'), TypeError);
  assert.throws(() => decodeTrackPage({ data: { ...wire.data, segments: [
    { ...wire.data.segments[0], points: [point(999, 20, 1)] },
  ] } }, 'ac_a'), TypeError);
});
