import type { Result } from '../../../kernel/result.ts';
import type { PositionIdentityDecision, PositionObservation, PositionParseError } from '../domain/position-observation.ts';

export type PositionObservationAppendError =
  | { readonly code: 'INVALID_POSITION_OBSERVATION'; readonly error: PositionParseError }
  | { readonly code: 'UNSTABLE_SOURCE_OBSERVATION_ID' }
  | { readonly code: 'SOURCE_OBSERVATION_CONFLICT' };

export interface PositionObservationAppendResult {
  readonly status: 'INSERTED' | 'ALREADY_PRESENT';
  readonly eventId: string;
  readonly observation: PositionObservation;
}

/** Stores an immutable source fact and its producer event atomically. */
export interface PositionHistoryWriter {
  append(input: unknown, identityDecision?: PositionIdentityDecision): Promise<Result<PositionObservationAppendResult, PositionObservationAppendError>>;
}
