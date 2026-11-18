import type { Brand } from '../../kernel/brand.ts';
import { err, ok, type Result } from '../../kernel/result.ts';
import type { InvalidId } from './invalid-id.ts';
export type AircraftId = Brand<string, 'AircraftId'>;
export function aircraftId(input: string): Result<AircraftId, InvalidId> {
  return /^ac_[a-zA-Z0-9-]{1,64}$/.test(input)
    ? ok(input as AircraftId) : err({ code: 'INVALID_ID', kind: 'AircraftId' });
}
