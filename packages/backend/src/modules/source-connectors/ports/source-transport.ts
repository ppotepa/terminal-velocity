import type { AcceptanceResult } from '../application/accept-source-delivery.ts';
import type { Result } from '../../../kernel/result.ts';

export type SourceTransportError =
  | { readonly code: 'TEMPORARY_FAILURE'; readonly retryAfterMs?: number }
  | { readonly code: 'RATE_LIMITED'; readonly retryAfterMs: number }
  | { readonly code: 'PERMANENT_FAILURE' };

/** Fetches one raw delivery; parsing and normalization are handled by SourceParser. */
export interface SourceDeliveryReader<TRaw> {
  receiveNext(): Promise<Result<TRaw, SourceTransportError>>;
}

/** Retrieval time belongs to the transport. The parser supplies any source observation time. */
export interface SourceDeliveryEnvelope<Raw> {
  readonly source: string;
  readonly retrievedAt: number;
  readonly raw: Raw;
}

/** A private observation window. Only a committed acceptance result counts as acknowledged. */
export interface SourceTransport<Raw> {
  start(onDelivery: (raw: Raw) => Promise<AcceptanceResult>,
    signal?: AbortSignal): Promise<ConnectionOutcome>;
  stop(): Promise<void>;
  health(): ProviderConnectionHealth;
}

export interface SourcePreview extends Pick<SourceTransport<never>, 'stop' | 'health'> {
  start(signal?: AbortSignal): Promise<ConnectionOutcome>;
}

export type ConnectionOutcome = 'COMPLETE' | 'STOPPED' | 'API_UNAVAILABLE' | 'RIGHTS_BLOCKED'
  | 'TEMPORARY_FAILURE' | 'PERMANENT_FAILURE' | 'RATE_LIMITED' | 'INVALID_ENVELOPE'
  | 'QUEUE_FULL' | 'ACCEPTANCE_FAILED';

export interface ProviderConnectionHealth {
  readonly state: 'DISCONNECTED' | 'DEGRADED' | 'HEALTHY';
  readonly outcome: ConnectionOutcome | null;
  readonly lastReceivedAt: number | null;
  readonly accepted: number;
  readonly coverage: 'UNKNOWN';
}
