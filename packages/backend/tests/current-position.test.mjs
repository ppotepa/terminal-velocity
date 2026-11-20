import assert from 'node:assert/strict';
import test from 'node:test';
import { comparePositionEvidence, classifyPositionFreshness } from '../src/modules/flight-tracking/public/index.ts';

const rank = (overrides = {}) => ({ observedAtMs: 10, nic: null, nacP: null,
  containmentRadiusMeters: null, measurementRank: 3, sourcePriority: 0,
  sourceId: 'src_a', observationId: '00000000-0000-0000-0000-000000000001', ...overrides });

test('later observation wins regardless of quality or source priority', () => {
  assert.ok(comparePositionEvidence(rank({ observedAtMs: 11, nic: null, sourcePriority: -10 }),
    rank({ observedAtMs: 10, nic: 11, sourcePriority: 10 })) > 0);
});

test('equal-time quality and configured priority have a total stable order', () => {
  assert.ok(comparePositionEvidence(rank({ nic: 8 }), rank({ nic: null })) > 0);
  assert.ok(comparePositionEvidence(rank({ nic: 8, nacP: 7 }), rank({ nic: 8, nacP: 6 })) > 0);
  assert.ok(comparePositionEvidence(rank({ containmentRadiusMeters: 10 }),
    rank({ containmentRadiusMeters: 20 })) > 0);
  assert.ok(comparePositionEvidence(rank({ measurementRank: 3 }), rank({ measurementRank: 2 })) > 0);
  assert.ok(comparePositionEvidence(rank({ sourcePriority: 2 }), rank({ sourcePriority: 1 })) > 0);
  assert.ok(comparePositionEvidence(rank({ sourceId: 'src_a' }), rank({ sourceId: 'src_b' })) > 0);
  assert.ok(comparePositionEvidence(rank({ observationId: '00000000-0000-0000-0000-000000000001' }),
    rank({ observationId: '00000000-0000-0000-0000-000000000002' })) > 0);
  assert.equal(comparePositionEvidence(rank(), rank()), 0);
});

test('position freshness uses the observation clock and exposes an uncertainty boundary', () => {
  const observation = { observedAt: '2026-11-20T11:59:00.000Z',
    timestampPrecision: 'MILLISECOND', timestampUncertaintyMs: 0 };
  const policy = { currentWithinMs: 60_000 };
  assert.equal(classifyPositionFreshness(observation, '2026-11-20T11:59:59.998Z', policy), 'CURRENT');
  assert.equal(classifyPositionFreshness(observation, '2026-11-20T11:59:59.999Z', policy), 'UNKNOWN');
  assert.equal(classifyPositionFreshness(observation, '2026-11-20T12:00:00.000Z', policy), 'UNKNOWN');
  assert.equal(classifyPositionFreshness(observation, '2026-11-20T12:00:00.001Z', policy), 'STALE');
});
