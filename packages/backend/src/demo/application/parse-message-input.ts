import { messageId } from '../../contracts/identity/index.ts';
import { icao24, registration, type StrongIdentifier } from '../../modules/aircraft-correlation/public/index.ts';
import { DEMO_BEARERS, type DemoBearer } from '../domain/bearer.ts';
import { MAX_CALLSIGN_LENGTH, MAX_MESSAGE_TEXT_LENGTH } from '../domain/limits.ts';
import type { ApiResult } from '../public/types.ts';
import type { ParsedMessage } from './parsed-message.ts';
import { apiError } from './api-error.ts';
import { parseUtcTime } from './parse-utc-time.ts';
const allowedKeys = new Set(['messageId', 'observedAt', 'bearer', 'text', 'icao24', 'registration', 'callsign']);
/** Copies primitive fields synchronously, before ingest can enter an async queue. */
export function parseMessageInput(input: unknown): ApiResult<ParsedMessage> {
  try {
    if (input === null || typeof input !== 'object' || Array.isArray(input))
      return apiError('VALIDATION_ERROR', 'A plain message object is required.');
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null)
      return apiError('VALIDATION_ERROR', 'A plain message object is required.');
    const fields: Record<string, string> = Object.create(null);
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== 'string' || !allowedKeys.has(key))
        return apiError('VALIDATION_ERROR', 'The message contains unsupported fields.');
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string')
        return apiError('VALIDATION_ERROR', 'All provided message fields must be plain strings.');
      fields[key] = descriptor.value;
    }
    const idText = fields['messageId'], timeText = fields['observedAt'];
    const bearerText = fields['bearer'], text = fields['text'];
    if (idText === undefined || timeText === undefined || bearerText === undefined || text === undefined)
      return apiError('VALIDATION_ERROR', 'messageId, observedAt, bearer and text are required.');
    const id = messageId(idText), time = parseUtcTime(timeText);
    if (!id.ok) return apiError('VALIDATION_ERROR', 'messageId must use the msg_ prefix and a valid identifier.');
    if (!time.ok) return time;
    if (!DEMO_BEARERS.some(item => item === bearerText))
      return apiError('VALIDATION_ERROR', 'Unsupported bearer.');
    if (text.length === 0 || text.length > MAX_MESSAGE_TEXT_LENGTH || text.trim().length === 0)
      return apiError('VALIDATION_ERROR', `text must contain 1 to ${MAX_MESSAGE_TEXT_LENGTH} UTF-16 code units.`);
    const identifiers: StrongIdentifier[] = [];
    let normalizedIcao: string | null = null, normalizedRegistration: string | null = null;
    if (fields['icao24'] !== undefined) {
      const parsed = icao24(fields['icao24']);
      if (!parsed.ok) return apiError('VALIDATION_ERROR', 'Invalid ICAO24 identifier.');
      normalizedIcao = parsed.value; identifiers.push(Object.freeze({ kind: 'ICAO24', value: parsed.value }));
    }
    if (fields['registration'] !== undefined) {
      const parsed = registration(fields['registration']);
      if (!parsed.ok) return apiError('VALIDATION_ERROR', 'Invalid registration.');
      normalizedRegistration = parsed.value; identifiers.push(Object.freeze({ kind: 'REGISTRATION', value: parsed.value }));
    }
    const callsign = fields['callsign'] === undefined ? null : fields['callsign'].trim().toUpperCase();
    if (callsign !== null && (callsign.length > MAX_CALLSIGN_LENGTH || !/^[A-Z0-9-]{1,16}$/.test(callsign)))
      return apiError('VALIDATION_ERROR', 'Invalid callsign.');
    return { ok: true, value: Object.freeze({
      canonical: Object.freeze({ messageId: id.value, observedAt: time.value.value, observedAtIso: time.value.iso,
        bearer: bearerText as DemoBearer, text, icao24: normalizedIcao, registration: normalizedRegistration, callsign }),
      identifiers: Object.freeze(identifiers),
    }) };
  } catch { return apiError('VALIDATION_ERROR', 'The message object could not be parsed.'); }
}
