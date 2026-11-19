import type { Result } from '../../../kernel/result.ts';
import type { PositionSourceId } from '../domain/position-identifiers.ts';
import type { PositionObservation, PositionParseError } from '../domain/position-observation.ts';

export interface PositionParseContext {
  readonly sourceId: PositionSourceId;
  readonly ingestedAt: string;
}

export interface PositionAdapter<TRaw, TContext extends PositionParseContext = PositionParseContext> {
  /** Provider-specific parsing must preserve the provider's own observation ID and timestamp evidence. */
  parse(raw: TRaw, context: TContext): Result<PositionObservation, PositionParseError>;
}
