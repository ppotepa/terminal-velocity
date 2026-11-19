import type { Brand } from '../../../kernel/brand.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';

export type PositionSourceId = Brand<string, 'PositionSourceId'>;
export type SourceObservationId = Brand<string, 'SourceObservationId'>;

export type InvalidPositionIdentifier = {
  readonly code: 'INVALID_POSITION_IDENTIFIER';
  readonly field: 'sourceId' | 'sourceObservationId';
};

const isOpaqueText = (value: string, maximumLength: number): boolean =>
  value.length > 0 && value.length <= maximumLength && value === value.trim()
  && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);

/** Application-assigned ID for a configured position source. */
export function positionSourceId(input: string): Result<PositionSourceId, InvalidPositionIdentifier> {
  return /^src_[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/u.test(input)
    ? ok(input as PositionSourceId)
    : err({ code: 'INVALID_POSITION_IDENTIFIER', field: 'sourceId' });
}

/** Opaque provider observation ID; it is scoped by the source configuration ID. */
export function sourceObservationId(input: string): Result<SourceObservationId, InvalidPositionIdentifier> {
  return isOpaqueText(input, 256)
    ? ok(input as SourceObservationId)
    : err({ code: 'INVALID_POSITION_IDENTIFIER', field: 'sourceObservationId' });
}
