export type ConsumeOutcome = 'APPLIED' | 'DUPLICATE' | 'STALE_LEASE';
export type RetryOutcome = 'RETRY_SCHEDULED' | 'QUARANTINED' | 'STALE_LEASE';
export type QuarantineOutcome = 'QUARANTINED' | 'STALE_LEASE';

export interface RetryRequest {
  /** An internal classification, never a raw exception message or payload. */
  readonly code: string;
  readonly delayMs: number;
}
