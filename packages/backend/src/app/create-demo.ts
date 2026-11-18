import { aircraftId, eventId, messageId } from '../contracts/identity/index.ts';
import { epochMillis } from '../kernel/time/epoch-millis.ts';
import { createCorrelateMessage, icao24, registration, type AircraftCandidate } from '../modules/aircraft-correlation/public/index.ts';
import { createMemoryDecisionStore } from '../modules/aircraft-correlation/infrastructure/memory-decision-store.ts';
import { unwrap } from './unwrap.ts';
/** Jawny composition root — jedyne miejsce spinające use case z adapterem. */
export function createDemo() {
  const aircraft = unwrap(aircraftId('ac_A'));
  const secondAircraft = unwrap(aircraftId('ac_B'));
  const message = unwrap(messageId('msg_001'));
  const at = unwrap(epochMillis(1_000_000));
  const identifier = { kind: 'ICAO24' as const, value: unwrap(icao24('48c2b4')) };
  const candidate: AircraftCandidate = { aircraftId: aircraft, aliases: [
    { identifier, validFrom: unwrap(epochMillis(0)), validUntil: null },
    { identifier: { kind: 'REGISTRATION', value: unwrap(registration('SP-LVD')) }, validFrom: unwrap(epochMillis(0)), validUntil: null },
  ] };
  let sequence = 0;
  const memory = createMemoryDecisionStore();
  const correlate = createCorrelateMessage({
    directory: { async find() { return { revision: 'directory/7', completeness: 'COMPLETE', candidates: [candidate] }; } },
    clock: { now: () => at }, transaction: memory.transaction,
    eventIds: { next: () => unwrap(eventId(`evt_${++sequence}`)) },
  });
  return { aircraft, secondAircraft, message, at, memory, correlate,
    input: { messageId: message, effectiveAt: at, identifiers: [identifier], callsign: 'LOT123' } };
}
