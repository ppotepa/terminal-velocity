import type { CanonicalMessage } from './canonical-message.ts';
export function sameCanonicalMessage(left: CanonicalMessage, right: CanonicalMessage): boolean {
  return left.messageId === right.messageId && left.observedAt === right.observedAt &&
    left.bearer === right.bearer && left.text === right.text && left.icao24 === right.icao24 &&
    left.registration === right.registration && left.callsign === right.callsign;
}
