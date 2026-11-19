import type { Result } from '../../../kernel/result.ts';

export type ReplayError = 'RETRY_AFTER' | 'TRANSIENT_FAILURE' | 'MALFORMED_PAYLOAD'
  | 'UNAUTHORIZED' | 'QUOTA_EXHAUSTED' | 'RIGHTS_REVOKED' | 'CURSOR_EXPIRED'
  | 'BUDGET_EXHAUSTED' | 'INCOMPLETE_TIME' | 'CLOCK_SKEW';
export interface ReplayScope { sourceId: string; provider: string; account: string; sourceEpoch: string; }
export interface ReplayRequest extends ReplayScope {
  checkpoint: string; from: number; to: number; limit: number; mode: 'SYNTHETIC' | 'PERMITTED';
}
export interface ReplayPolicy {
  maxWindowMs: number; maxRequests: number; maxPageBytes: number; maxPageRecords: number;
  minIntervalMs: number; maxAttempts: number; maxRetryMs: number; requestTimeoutMs: number;
  retryStatuses: readonly number[];
}
export interface SourceHealth {
  connectionState: 'DISCONNECTED' | 'HEALTHY' | 'DEGRADED' | 'DISABLED';
  fetchOutcome: 'NONE' | 'OK' | ReplayError;
  parseOutcome: 'NONE' | 'OK' | ReplayError;
  receiptOutcome: 'NONE' | 'OK' | ReplayError;
  lastConnectionAt: number | null; lastProviderEventAt: number | null;
  ingestLag: number | null; coverageKind: 'SAMPLED' | 'UNKNOWN'; asOf: number;
}
export interface ReplayCheckpoint {
  request: ReplayRequest; cursor: string | null; state: 'READY' | 'COMPLETE' | 'QUARANTINED';
  attemptId: number; attempts: number; requests: number; processed: number;
  applied: number; duplicate: number; quarantined: number; nextAttemptAt: number;
  lastError: ReplayError | null; health: SourceHealth; reviews: number;
}
export interface ReplaySession {
  read(): Promise<ReplayCheckpoint | null>;
  save(checkpoint: ReplayCheckpoint): Promise<void>;
}
/** Exclusive across the entire source scope, not merely a range or worker. */
export interface SourceReplayStore {
  exclusive<T>(scope: ReplayScope, work: (session: ReplaySession) => Promise<T>): Promise<T>;
}
export interface ReplayPage<Raw> { records: readonly Raw[]; nextCursor: string | null; bytes: number; }
export interface ReplayFailure { code: ReplayError; status?: number; retryAfterMs?: number; }
export interface ReplayReader<Raw> {
  /** Adapter must enforce byte/record limits while reading, and stop on abort. */
  read(input: { request: ReplayRequest; cursor: string | null; maxBytes: number;
    maxRecords: number; signal: AbortSignal }): Promise<Result<ReplayPage<Raw>, ReplayFailure>>;
}
export interface ReplayDelivery<Raw> {
  /** Validate the entire page before any receipt. Null time is not treated as current. */
  observedAt(raw: Raw): Result<number, ReplayError>;
  /** Existing atomic acceptance boundary: success means durable receipt, never a preview. */
  accept(raw: Raw): Promise<Result<'CREATED' | 'DUPLICATE', ReplayFailure>>;
}
