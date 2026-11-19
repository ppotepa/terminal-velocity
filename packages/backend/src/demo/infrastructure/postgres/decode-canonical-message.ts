import type { CanonicalMessage } from '../../domain/canonical-message.ts';
import { parseMessageInput } from '../../application/parse-message-input.ts';
const canonicalKeys = new Set(['messageId', 'observedAt', 'observedAtIso', 'bearer', 'text', 'icao24', 'registration', 'callsign']);

export function decodeCanonicalMessage(value: unknown, expectedId: string): CanonicalMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored message facts.');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== canonicalKeys.size || Object.keys(row).some(key => !canonicalKeys.has(key)))
    throw new Error('Invalid stored message fact fields.');
  const input: Record<string, unknown> = { messageId: row['messageId'], observedAt: row['observedAtIso'],
    bearer: row['bearer'], text: row['text'] };
  for (const key of ['icao24', 'registration', 'callsign']) if (row[key] !== null) input[key] = row[key];
  const parsed = parseMessageInput(input);
  if (!parsed.ok || parsed.value.canonical.messageId !== expectedId ||
    parsed.value.canonical.observedAt !== row['observedAt'] ||
    parsed.value.canonical.icao24 !== row['icao24'] || parsed.value.canonical.registration !== row['registration'] ||
    parsed.value.canonical.callsign !== row['callsign']) throw new Error('Stored message facts failed validation.');
  return parsed.value.canonical;
}
