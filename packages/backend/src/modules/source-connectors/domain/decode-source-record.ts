import { err, ok, type Result } from '../../../kernel/result.ts';
import { hasOnlyKeys, plainRecord } from './input-validation.ts';
import type { NormalizationError } from './normalized-observation.ts';

/** Our synthetic extracted-record schema, NOT an asserted Airframes API version. */
export const EXTRACTED_RECORD_VERSION = 'synthetic-rendered-record-v1';
const fields = ['schemaVersion', 'originalSourceId', 'deliveryId', 'sourceDescription', 'decoder',
  'dataLevel', 'text', 'sourceObservedAt', 'receiverReceivedAt', 'providerPublishedAt',
  'bearer', 'applicationProtocol', 'direction', 'aircraft', 'originator', 'addressee',
  'feeder', 'receiverId', 'frequencyHz', 'signalStrengthDbm', 'frameBytesBase64'];

export function decodePayload(input: unknown): Result<Record<string, unknown>, NormalizationError> {
  const record = plainRecord(input);
  const fail = (code: NormalizationError['code'], field: string) =>
    err({ code, field, schemaVersion: EXTRACTED_RECORD_VERSION });
  if (!record) return fail('INVALID_INPUT', '$');
  if (record['schemaVersion'] !== EXTRACTED_RECORD_VERSION) return fail('UNKNOWN_SCHEMA', 'schemaVersion');
  if (!hasOnlyKeys(record, fields)) return fail('INVALID_INPUT', '$');
  return ok(record);
}
