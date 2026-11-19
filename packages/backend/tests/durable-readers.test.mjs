import test from 'node:test';
import assert from 'node:assert/strict';
import { createListDurableAircraft } from '../src/demo/application/list-durable-aircraft.ts';
import { createGetDurableAircraft } from '../src/demo/application/get-durable-aircraft.ts';
import { createFixtureFleet } from '../src/demo/infrastructure/fixture-fleet.ts';
import { freshnessPolicy } from '../src/modules/message-availability/public/index.ts';

test('durable freshness uses the clock after the awaited projection read', async () => {
  const fleet = createFixtureFleet(), policy = freshnessPolicy(600_000, 3_600_000).value;
  let now = 1_000;
  const reader = { async lastMessageTimes() { now = 3_000; return new Map([[fleet[0].aircraftId, 2_000]]); } };
  const list = await createListDurableAircraft(fleet, reader, policy, () => now)();
  assert.equal(list.value[0].availability.freshness, 'RECENT');
  now = 1_000;
  const single = await createGetDurableAircraft(fleet, reader, policy, () => now)(fleet[0].aircraftId);
  assert.equal(single.value.availability.freshness, 'RECENT');
});
