import { DEFAULT_REPLAY_POLICY, sameReplay, validateReplayPolicy, validateReplayRequest } from '../domain/replay-policy.ts';
import type { ReplayCheckpoint, ReplayDelivery, ReplayFailure, ReplayPolicy, ReplayReader,
  ReplayRequest, SourceHealth, SourceReplayStore } from '../ports/source-replay-checkpoint.ts';
import { initialSourceHealth } from './source-health.ts';
import { planSourceRetry } from './plan-source-retry.ts';
import { quarantineSourceDelivery } from './quarantine-source-delivery.ts';

export interface ReplayDependencies<Raw> {
  store: SourceReplayStore; reader: ReplayReader<Raw>; delivery: ReplayDelivery<Raw>;
  /** Recheck current collection permission before every fetch, including synthetic scope. */
  authorized(request: ReplayRequest): Promise<boolean>;
  coverageKind: SourceHealth['coverageKind']; now(): number; policy?: ReplayPolicy;
}
/** One page per invocation. Cooldowns persist; callers cannot create a retry storm by restarting. */
export async function replaySourceRange<Raw>(request: ReplayRequest, deps: ReplayDependencies<Raw>): Promise<ReplayCheckpoint> {
  const policy = deps.policy ?? DEFAULT_REPLAY_POLICY;
  validateReplayPolicy(policy);
  validateReplayRequest(request, policy);
  request = { sourceId: request.sourceId, provider: request.provider, account: request.account,
    sourceEpoch: request.sourceEpoch, checkpoint: request.checkpoint, from: request.from,
    to: request.to, limit: request.limit, mode: request.mode };
  return deps.store.exclusive(request, async session => {
    let checkpoint = await session.read();
    const now = deps.now();
    if (!Number.isSafeInteger(now) || now < request.to) throw new Error('Replay requires a completed historical window.');
    const previous = checkpoint;
    if (checkpoint && !sameReplay(checkpoint.request, request)) {
      if (checkpoint.state !== 'COMPLETE' || checkpoint.request.checkpoint === request.checkpoint)
        throw new Error('An unresolved checkpoint must be reviewed before changing the range.');
      checkpoint = null;
    }
    const c: ReplayCheckpoint = checkpoint ?? { request, cursor: null, state: 'READY', attemptId: 0,
      attempts: 0, requests: 0, processed: 0, applied: 0, duplicate: 0, quarantined: 0,
      nextAttemptAt: previous?.nextAttemptAt ?? 0, lastError: null,
      health: previous ? { ...previous.health } : initialSourceHealth(now, deps.coverageKind), reviews: 0 };
    if (c.state !== 'READY' || now < c.nextAttemptAt) return c;
    c.health.asOf = now;
    const fail = async (failure: ReplayFailure, phase: 'fetchOutcome' | 'parseOutcome' | 'receiptOutcome') => {
      const allowed = ['RETRY_AFTER', 'TRANSIENT_FAILURE', 'MALFORMED_PAYLOAD', 'UNAUTHORIZED',
        'QUOTA_EXHAUSTED', 'RIGHTS_REVOKED', 'CURSOR_EXPIRED', 'BUDGET_EXHAUSTED', 'INCOMPLETE_TIME', 'CLOCK_SKEW'];
      if (!allowed.includes(failure.code)) failure = { code: 'MALFORMED_PAYLOAD' };
      const receivedAt = deps.now();
      c.health.asOf = receivedAt;
      c.lastError = failure.code;
      c.health[phase] = failure.code;
      c.health.connectionState = 'DEGRADED';
      c.attempts += 1;
      // Provider cooldown is independent of our automatic retry budget. Review and
      // restart must not turn a quarantined 429 into an early provider request.
      if (typeof failure.retryAfterMs === 'number' && Number.isFinite(failure.retryAfterMs)
        && failure.retryAfterMs >= 0) {
        const deadline = Math.min(Number.MAX_SAFE_INTEGER, receivedAt + Math.ceil(failure.retryAfterMs));
        c.nextAttemptAt = Math.max(c.nextAttemptAt, deadline);
      }
      const retry = planSourceRetry(failure, c.attempts, policy);
      if (retry.kind === 'RETRY') c.nextAttemptAt = Math.max(c.nextAttemptAt, receivedAt + retry.delayMs);
      else quarantineSourceDelivery(c, failure.code);
      await session.save(c);
      return c;
    };
    let permitted;
    try { permitted = await deps.authorized(request); }
    catch { return fail({ code: 'TRANSIENT_FAILURE' }, 'fetchOutcome'); }
    if (!permitted) return fail({ code: 'RIGHTS_REVOKED' }, 'fetchOutcome');
    if (c.requests >= policy.maxRequests || c.processed >= request.limit)
      return fail({ code: 'BUDGET_EXHAUSTED' }, 'fetchOutcome');
    // Reserve the attempt and rate slot durably BEFORE making a provider request.
    c.requests += 1;
    c.attemptId += 1;
    c.nextAttemptAt = deps.now() + Math.max(policy.minIntervalMs, policy.requestTimeoutMs);
    c.health.connectionState = 'DISCONNECTED';
    c.health.fetchOutcome = 'NONE'; c.health.parseOutcome = 'NONE'; c.health.receiptOutcome = 'NONE';
    await session.save(c);
    const maxRecords = Math.min(policy.maxPageRecords, request.limit - c.processed);
    let result;
    const signal = AbortSignal.timeout(policy.requestTimeoutMs);
    try {
      result = await deps.reader.read({ request, cursor: c.cursor, maxBytes: policy.maxPageBytes,
        maxRecords, signal });
      signal.throwIfAborted();
    } catch { return fail({ code: 'TRANSIENT_FAILURE' }, 'fetchOutcome'); }
    if (!result.ok) {
      // A reader may recognize schema drift only after receiving a valid response.
      if (result.error.code === 'MALFORMED_PAYLOAD') {
        c.health.fetchOutcome = 'OK'; c.health.lastConnectionAt = deps.now();
        return fail(result.error, 'parseOutcome');
      }
      return fail(result.error, 'fetchOutcome');
    }
    const receivedAt = deps.now();
    c.nextAttemptAt = Math.max(c.nextAttemptAt, receivedAt + policy.minIntervalMs);
    c.health.fetchOutcome = 'OK'; c.health.lastConnectionAt = receivedAt;
    const page = result.value;
    if (!page || typeof page !== 'object' || !Number.isInteger(page.bytes) || page.bytes < 0 || page.bytes > policy.maxPageBytes
      || !Array.isArray(page.records) || page.records.length > maxRecords
      || (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || page.nextCursor.length < 1
        || page.nextCursor.length > 2048 || page.nextCursor === c.cursor)))
      return fail({ code: 'MALFORMED_PAYLOAD' }, 'parseOutcome');
    try {
      if (new TextEncoder().encode(JSON.stringify(page.records)).byteLength > policy.maxPageBytes)
        return fail({ code: 'MALFORMED_PAYLOAD' }, 'parseOutcome');
    } catch { return fail({ code: 'MALFORMED_PAYLOAD' }, 'parseOutcome'); }
    const times: number[] = [];
    for (const record of page.records) {
      let time;
      try { time = deps.delivery.observedAt(record); }
      catch { return fail({ code: 'MALFORMED_PAYLOAD' }, 'parseOutcome'); }
      if (!time.ok) return fail({ code: time.error }, 'parseOutcome');
      if (time.value > deps.now()) return fail({ code: 'CLOCK_SKEW' }, 'parseOutcome');
      if (!Number.isSafeInteger(time.value) || time.value < request.from || time.value >= request.to)
        return fail({ code: 'INCOMPLETE_TIME' }, 'parseOutcome');
      times.push(time.value);
    }
    c.health.parseOutcome = 'OK';
    if (times.length) {
      c.health.lastProviderEventAt = Math.max(c.health.lastProviderEventAt ?? 0, ...times);
      c.health.ingestLag = Math.max(0, deps.now() - c.health.lastProviderEventAt);
    }

    for (const record of page.records) {
      try { permitted = await deps.authorized(request); }
      catch { return fail({ code: 'TRANSIENT_FAILURE' }, 'receiptOutcome'); }
      if (!permitted) return fail({ code: 'RIGHTS_REVOKED' }, 'receiptOutcome');
      let receipt;
      try { receipt = await deps.delivery.accept(record); }
      catch { return fail({ code: 'TRANSIENT_FAILURE' }, 'receiptOutcome'); }
      if (!receipt.ok) return fail(receipt.error, 'receiptOutcome');
      if (receipt.value !== 'CREATED' && receipt.value !== 'DUPLICATE')
        return fail({ code: 'MALFORMED_PAYLOAD' }, 'receiptOutcome');
      if (receipt.value === 'CREATED') c.applied += 1; else c.duplicate += 1;
      c.processed += 1;
    }
    c.health.receiptOutcome = 'OK';
    // A lost ACK repeats the page through the existing durable identity check.
    c.cursor = page.nextCursor;
    c.state = page.nextCursor === null ? 'COMPLETE' : 'READY';
    c.attempts = 0; c.lastError = null;
    c.health.connectionState = 'HEALTHY';
    c.health.asOf = deps.now();
    await session.save(c);
    return c;
  });
}
