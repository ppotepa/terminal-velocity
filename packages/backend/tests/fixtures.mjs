import assert from 'node:assert/strict';
import { aircraftId, messageId, revision } from '../src/contracts/identity/index.ts';
import { epochMillis } from '../src/kernel/time/epoch-millis.ts';
import { icao24, registration } from '../src/modules/aircraft-correlation/public/index.ts';
export function take(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; }
export const A = take(aircraftId('ac_A'));
export const B = take(aircraftId('ac_B'));
export const M = take(messageId('msg_001'));
export const M2 = take(messageId('msg_002'));
export const at = n => take(epochMillis(n));
export const rev = n => take(revision(n));
export const icao = value => ({ kind: 'ICAO24', value: take(icao24(value)) });
export const reg = value => ({ kind: 'REGISTRATION', value: take(registration(value)) });
export function candidate(id, identifiers, from = 0, until = null) {
  return { aircraftId: id, aliases: identifiers.map(identifier => ({ identifier, validFrom: at(from), validUntil: until === null ? null : at(until) })) };
}
export function input(ids, time = 1_000_000) {
  return { messageId: M, effectiveAt: at(time), identifiers: ids, callsign: null };
}
export function assign(aircraft, time, revision = 1, message = M, extras = {}) {
  return { type: 'ASSIGNED', revision: rev(revision), contribution: {
    aircraftId: aircraft, messageId: message, observedAt: at(time), bearer: 'VDL2', publicEligible: true, ...extras,
  } };
}
