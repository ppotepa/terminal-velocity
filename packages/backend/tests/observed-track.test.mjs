import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildObservedTrack, simplifyObservedTrack, observedTrackQuery,
} from '../src/modules/flight-tracking/public/index.ts';

const point = (number, observedAtMs, latitude, longitude) => ({
  observationId: `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`,
  sourceId: 'src_synthetic', sourceObservationId: `epoch:test:${number}`,
  observedAtMs, latitude, longitude, measurementKind: 'ADS_B', quality: { nic: 8 },
  timestampPrecision: 'SECOND', timestampUncertaintyMs: 0,
});

test('observed geometry splits time gaps and physically impossible jumps', () => {
  const rows = [point(1, 0, 0, 0), point(2, 60_000, 0.1, 0.1),
    point(3, 700_001, 0.2, 0.2), point(4, 710_001, 40, 40)];
  const segments = buildObservedTrack(rows);
  assert.deepEqual(segments.map(segment => segment.breakBefore),
    [null, 'TIME_GAP', 'IMPLAUSIBLE_JUMP']);
  assert.deepEqual(segments.map(segment => segment.points.length), [2, 1, 1]);
  assert.equal(segments.flatMap(segment => segment.points).length, 4);
});

test('dateline crossing is a wrap break with only observed endpoints', () => {
  const west = point(1, 0, 10, 179.5);
  const east = point(2, 600_000, 10, -179.5);
  const segments = buildObservedTrack([west, east]);
  assert.equal(segments[1].breakBefore, 'ANTIMERIDIAN_WRAP');
  assert.deepEqual(segments.flatMap(segment => segment.points), [west, east]);
});

test('out-of-order and repeated facts normalize deterministically; conflicting repeat fails', () => {
  const first = point(1, 0, 0, 0);
  const second = point(2, 10_000, 0.01, 0.01);
  assert.deepEqual(buildObservedTrack([second, first, first]), buildObservedTrack([first, second]));
  assert.throws(() => buildObservedTrack([first, { ...first, latitude: 3 }]), /Conflicting/);
  assert.equal(buildObservedTrack([first, { ...point(3, 0, 1, 1) }])[1].breakBefore,
    'SAME_TIME_CONFLICT');
});

test('continuation across pages remains explicit and never invents a seam point', () => {
  const previous = point(1, 0, 0, 0);
  const next = point(2, 10_000, 0.01, 0.01);
  const continued = buildObservedTrack([next], previous);
  assert.equal(continued[0].continuesPrevious, true);
  assert.equal(continued[0].points.length, 1);
  assert.equal(buildObservedTrack([point(3, 700_000, 1, 1)], previous)[0].breakBefore, 'TIME_GAP');
});

test('simplification is stable, bounded, and preserves all segment endpoints', () => {
  const rows = Array.from({ length: 200 }, (_, i) => point(i + 1, i * 10_000,
    Math.sin(i / 20) / 10, i / 100));
  const one = simplifyObservedTrack(buildObservedTrack(rows), 15, 6);
  const two = simplifyObservedTrack(buildObservedTrack([...rows].reverse()), 15, 6);
  assert.deepEqual(one, two);
  assert.ok(one[0].points.length <= 15);
  assert.deepEqual(one[0].points[0], rows[0]);
  assert.deepEqual(one[0].points.at(-1), rows.at(-1));
  const split = buildObservedTrack([point(1, 0, 0, 0), point(2, 700_000, 1, 1)]);
  assert.throws(() => simplifyObservedTrack(split, 1, 6), /endpoint/);
});

test('track query bounds the window, page, zoom and cursor scope', () => {
  const query = { aircraftId: 'ac_a', fromObservedAtMs: 0, toObservedAtMs: 100_000,
    limit: 50, pointBudget: 25, zoom: 8 };
  assert.equal(observedTrackQuery(query).ok, true);
  assert.equal(observedTrackQuery({ ...query, zoom: 8.5 }).ok, true);
  assert.equal(observedTrackQuery({ ...query, limit: 501 }).ok, false);
  assert.equal(observedTrackQuery({ ...query, toObservedAtMs: 8 * 86_400_000 }).ok, false);
  assert.equal(observedTrackQuery({ ...query, zoom: 23 }).ok, false);
  const after = { aircraftId: 'ac_a', fromObservedAtMs: 0, toObservedAtMs: 100_000,
    projectionRevision: 1, observedAtMs: 50_000, sourceId: 'src_synthetic',
    observationId: '00000000-0000-0000-0000-000000000001' };
  assert.equal(observedTrackQuery({ ...query, after }).ok, true);
  assert.equal(observedTrackQuery({ ...query, after: { ...after, aircraftId: 'ac_b' } }).ok, false);
});
