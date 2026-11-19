import { createHash } from 'node:crypto';
import type { ReplayScope, SourceReplayStore } from '../../ports/source-replay-checkpoint.ts';
import { sourceHealth } from '../../application/source-health.ts';

/** Exact scoped inspection only; IDs are digested and no cursor, raw error or payload is returned. */
export async function inspectSourceReplay(store: SourceReplayStore, scope: ReplayScope, now: number) {
  return store.exclusive(scope, async session => {
    const c = await session.read();
    if (!c) return null;
    const safeId = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    return { source: safeId([scope.sourceId, scope.provider, scope.account, scope.sourceEpoch]),
      checkpoint: safeId(c.request.checkpoint), from: c.request.from, to: c.request.to,
      mode: c.request.mode, state: c.state, cursorPresent: c.cursor !== null, attemptId: c.attemptId,
      requests: c.requests, processed: c.processed, applied: c.applied, duplicate: c.duplicate,
      quarantined: c.quarantined, lastError: c.lastError, nextAttemptAt: c.nextAttemptAt,
      reviews: c.reviews, health: sourceHealth(c, now) };
  });
}
