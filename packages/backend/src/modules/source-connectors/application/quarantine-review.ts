import { validateReplayScope } from '../domain/replay-policy.ts';
import type { ReplayRequest, ReplayScope, SourceReplayStore } from '../ports/source-replay-checkpoint.ts';

/** Operator attests the cause is resolved; authorization is independently rechecked. */
export async function reviewSourceQuarantine(store: SourceReplayStore, scope: ReplayScope,
  checkpoint: string, resolution: 'RETRY_SAME_PAGE' | 'RESTART_BOUNDED_RANGE',
  authorized: (request: ReplayRequest) => Promise<boolean>) {
  validateReplayScope(scope);
  if (!['RETRY_SAME_PAGE', 'RESTART_BOUNDED_RANGE'].includes(resolution)) throw new Error('Invalid review resolution.');
  return store.exclusive(scope, async session => {
    const c = await session.read();
    if (!c || c.request.checkpoint !== checkpoint || c.state !== 'QUARANTINED')
      throw new Error('An exact quarantined checkpoint is required.');
    if (!await authorized(c.request)) throw new Error('Collection permission is required for review.');
    if (c.lastError === 'CURSOR_EXPIRED' && resolution !== 'RESTART_BOUNDED_RANGE')
      throw new Error('Expired cursors require an explicit bounded range restart.');
    if (resolution === 'RESTART_BOUNDED_RANGE') c.cursor = null;
    c.state = 'READY'; c.attempts = 0; c.requests = 0; c.processed = 0; c.reviews += 1;
    // Retain last failure, timestamps, cumulative counts and cooldown as review evidence.
    await session.save(c);
    return c;
  });
}
