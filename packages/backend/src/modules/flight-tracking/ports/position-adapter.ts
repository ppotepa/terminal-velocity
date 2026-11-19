import type { Result } from '../../../kernel/result.ts';
import type { PositionSourceId } from '../domain/position-identifiers.ts';
import type { PositionObservation, PositionParseError } from '../domain/position-observation.ts';

export interface PositionAdapter<TRaw> {
  /** Provider-specific parsing must preserve the provider's own observation ID and timestamp evidence. */
  parse(raw: TRaw, context: { readonly sourceId: PositionSourceId; readonly ingestedAt: string }):
    Result<PositionObservation, PositionParseError>;
}
