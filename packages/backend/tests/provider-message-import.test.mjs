import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, context, scope, NOW } from './integration/helpers/provider-fixture.mjs';
import { importProviderMessage, normalizeSourceObservation } from '../src/modules/source-connectors/public/index.ts';
import { createMemoryDecisionStore } from '../src/modules/aircraft-correlation/infrastructure/memory-decision-store.ts';
import { createFixtureCandidateDirectory } from '../src/demo/infrastructure/fixture-candidate-directory.ts';
import { createFixtureFleet } from '../src/demo/infrastructure/fixture-fleet.ts';
const directory = createFixtureCandidateDirectory(createFixtureFleet());
function harness(raw = fixture(), dir = directory) {
  const normalized = normalizeSourceObservation(raw, context(raw), scope.capabilities);
  assert.ok(normalized.ok);
  const state = createMemoryDecisionStore();
  const input = { canonical: normalized.value, messageId: 'msg_provider-fixture', sourceDeliveryId: 'synthetic-delivery', now: NOW };
  let inserted = 0, linked = 0, quarantine;
  const writes = { decisions: state.transaction, read: async () => null,
    insert: async () => { inserted++; }, link: async () => { linked++; }, quarantine: async reason => { quarantine = reason; } };
  return { input, writes, state, inspect: () => ({ inserted, linked, quarantine }),
    run: () => importProviderMessage(input, writes, dir, { next: () => 'evt_synthetic-fixture' }) };
}

test('provider import preserves observation time, registration and decision evidence through the public correlation use case', async () => {
  const h = harness(); const result = await h.run();
  assert.equal(result.outcome, 'IMPORTED');
  assert.equal(result.observedAt, NOW - 60_000);
  assert.equal(result.decision.revision, 1);
  assert.equal(result.decision.decision.aircraftId, 'ac_demo-001');
  assert.equal(result.decision.directoryRevision, 'synthetic-fleet/1');
  assert.deepEqual(h.inspect(), { inserted: 1, linked: 1, quarantine: undefined });
  assert.equal(h.state.inspect().outbox.length, 1);
});
for (const [name, change, expected] of [
  ['callsign alone', raw => { raw.aircraft = { callsign: 'DEMO101' }; }, 'UNMATCHED'],
  ['unknown aircraft', raw => { raw.aircraft = { icao24: 'FFFFFF' }; }, 'UNMATCHED'],
  ['conflicting strong hints', raw => { raw.aircraft.registration = 'DEMO-002'; }, 'CONFLICTED'],
]) test(`provider import preserves ${name} without confirmed status`, async () => {
  const raw = fixture(); change(raw); const result = await harness(raw).run();
  assert.equal(result.outcome, expected); assert.equal(result.decision.decision.status, expected);
});
test('provider import preserves ambiguous candidates', async () => {
  const fleet = createFixtureFleet();
  const h = harness(fixture(), createFixtureCandidateDirectory([...fleet, { ...fleet[0], aircraftId: 'ac_duplicate' }]));
  assert.equal((await h.run()).outcome, 'AMBIGUOUS');
});
for (const [name, change, reason] of [
  ['metadata only', h => { h.input.canonical = null; }, 'RETENTION_NOT_PERMITTED'],
  ['missing observation time', h => { h.input.canonical = { ...h.input.canonical,
    observation: { ...h.input.canonical.observation, observedAt: undefined } }; }, 'MISSING_OBSERVATION_TIME'],
  ['unsupported level', h => { h.input.canonical = { ...h.input.canonical,
    observation: { ...h.input.canonical.observation, dataLevel: 'FRAME' } }; }, 'UNSUPPORTED_LEVEL'],
  ['invalid ICAO', h => { h.input.canonical = { ...h.input.canonical, aircraftHints: { icao24: 'INVALID' } }; }, 'INVALID_CANONICAL'],
  ['future observation', h => { h.input.now = NOW - 120_000; }, 'INVALID_CANONICAL'],
]) test(`${name} quarantines before creating message effects`, async () => {
  const h = harness(); change(h);
  assert.equal((await h.run()).reason, reason);
  assert.deepEqual(h.inspect(), { inserted: 0, linked: 0, quarantine: reason });
  assert.equal(h.state.inspect().outbox.length, 0);
});
test('a duplicate provider fact adds delivery lineage without another decision; changed facts quarantine', async () => {
  const h = harness(); const previous = await h.run();
  h.writes.read = async () => ({ decision: previous.decision, sameFacts: true });
  assert.equal((await h.run()).outcome, 'DUPLICATE');
  assert.equal(h.inspect().inserted, 1); assert.equal(h.inspect().linked, 2);
  assert.equal(h.state.inspect().outbox.length, 1);
  h.writes.read = async () => ({ decision: previous.decision, sameFacts: false });
  assert.equal((await h.run()).reason, 'IDENTITY_CONFLICT');
  assert.equal(h.inspect().linked, 2);
});
test('incomplete candidates and failed outbox commit require enclosing transaction rollback', async () => {
  const h = harness(fixture(), { find: async () => ({ completeness: 'INCOMPLETE', reason: 'UNAVAILABLE' }) });
  await assert.rejects(h.run(), /CANDIDATE_SET_INCOMPLETE/);
  assert.equal(h.state.inspect().outbox.length, 0);
  const failed = harness(); failed.state.failNextOutboxAppend();
  await assert.rejects(failed.run(), /COMMIT_FAILED/);
  assert.equal(failed.state.inspect().records.size, 0);
});
