import type { Result } from '../../../kernel/result.ts';
import { err, ok } from '../../../kernel/result.ts';
import type { PositionSourceId } from '../domain/position-identifiers.ts';
import { parsePositionObservation, type PositionIdentityDecision, type PositionObservation, type PositionParseError } from '../domain/position-observation.ts';
import { validatePositionCapabilities, type PositionSourceCapabilities, type PositionCapabilityError } from '../domain/position-capabilities.ts';
import { utcTimestamp } from '../domain/position-time.ts';

export interface PositionAdapterContext {
  readonly sourceId: PositionSourceId;
  readonly ingestedAt: string;
  readonly capabilities: PositionSourceCapabilities;
  /** Trusted upstream identity decision for this delivery; never provider-supplied. */
  readonly identityDecision?: PositionIdentityDecision;
}

export interface PositionParseContext {
  readonly sourceId: PositionSourceId;
  readonly ingestedAt: string;
}

export interface PositionAdapter<TRaw, TContext extends PositionParseContext = PositionParseContext> {
  /** Provider-specific parsing must preserve the provider's own observation ID and timestamp evidence. */
  parse(raw: TRaw, context: TContext): Result<PositionObservation, PositionParseError>;
}

/** Revalidates adapter output so an adapter cannot bypass the canonical or configured source boundary. */
export function acceptPositionObservation<TRaw, TContext extends PositionAdapterContext>(
  adapter: PositionAdapter<TRaw, TContext>, raw: TRaw, context: TContext,
): Result<PositionObservation, PositionParseError | PositionCapabilityError> {
  if (context.sourceId !== context.capabilities.sourceId)
    return err({ code: 'UNSUPPORTED_POSITION_CAPABILITY', field: 'sourceId' });
  const ingestedAt = utcTimestamp(context.ingestedAt, 'ingestedAt');
  if (!ingestedAt.ok) return ingestedAt;
  const parsed = adapter.parse(raw, context);
  if (!parsed.ok) return parsed;
  const canonical = parsePositionObservation(parsed.value, context.identityDecision);
  if (!canonical.ok) return canonical;
  if (canonical.value.ingestedAt !== ingestedAt.value)
    return err({ code: 'INVALID_POSITION_TIME', field: 'ingestedAt' });
  const capabilities = validatePositionCapabilities(canonical.value, context.capabilities);
  return capabilities.ok ? ok(capabilities.value) : capabilities;
}
