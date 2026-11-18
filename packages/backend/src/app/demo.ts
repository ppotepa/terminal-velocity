import { revision } from '../contracts/identity/index.ts';
import { epochMillis } from '../kernel/time/epoch-millis.ts';
import { emptyAvailability, updateAvailability, freshnessPolicy, expireAvailability } from '../modules/message-availability/public/index.ts';
import { createDemo } from './create-demo.ts';
import { unwrap } from './unwrap.ts';
const demo = createDemo();
console.log('1. Aircraft correlation:', JSON.stringify(await demo.correlate(demo.input, null), null, 2));
console.log('2. Atomic outbox:', demo.memory.inspect().outbox.length, 'event');
const policy = unwrap(freshnessPolicy(600_000, 3_600_000));
let state = unwrap(updateAvailability(emptyAvailability(), { type: 'ASSIGNED', revision: unwrap(revision(1)),
  contribution: { messageId: demo.message, aircraftId: demo.aircraft, observedAt: demo.at, bearer: 'VDL2', publicEligible: true } }, demo.at, policy));
console.log('3. After reception:', state.snapshots.get(demo.aircraft)?.freshness);
const current = state.snapshots.get(demo.aircraft);
if (current?.nextTransitionAt) {
  state = unwrap(expireAvailability(state, { aircraftId: demo.aircraft, expectedRevision: current.revision, dueAt: current.nextTransitionAt }, current.nextTransitionAt, policy)).state;
}
console.log('4. At exactly 10 minutes:', state.snapshots.get(demo.aircraft)?.freshness);
state = unwrap(updateAvailability(state, { type: 'ASSIGNED', revision: unwrap(revision(2)),
  contribution: { messageId: demo.message, aircraftId: demo.secondAircraft, observedAt: demo.at, bearer: 'VDL2', publicEligible: true } }, unwrap(epochMillis(demo.at + 600_000)), policy));
console.log('5. Correction A → B:', { A: state.snapshots.get(demo.aircraft)?.freshness, B: state.snapshots.get(demo.secondAircraft)?.freshness });
