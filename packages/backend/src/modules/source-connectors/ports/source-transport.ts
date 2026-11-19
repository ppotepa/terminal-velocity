import type { Result } from '../../../kernel/result.ts';

export type SourceTransportError =
  | { readonly code: 'TEMPORARY_FAILURE'; readonly retryAfterMs?: number }
  | { readonly code: 'RATE_LIMITED'; readonly retryAfterMs: number }
  | { readonly code: 'PERMANENT_FAILURE' };

/** Fetches one raw delivery; parsing and normalization are handled by SourceParser. */
export interface SourceTransport<TRaw> {
  receiveNext(): Promise<Result<TRaw, SourceTransportError>>;
}
