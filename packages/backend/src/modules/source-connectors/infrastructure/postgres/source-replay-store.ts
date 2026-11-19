import type { SqlPool } from '../../../../contracts/database/index.ts';
import { validateReplayScope } from '../../domain/replay-policy.ts';
import type { ReplayCheckpoint, ReplayScope, SourceReplayStore } from '../../ports/source-replay-checkpoint.ts';

function scopeKey(scope: ReplayScope): string {
  validateReplayScope(scope);
  return JSON.stringify([scope.sourceId, scope.provider, scope.account, scope.sourceEpoch]);
}
/** Session lock serializes a scope while each checkpoint save commits independently.
 * Process death releases the lock. A failed lock connection prevents cursor advancement.
 * Receipt transactions use the acceptance pool; reserve at least two connections.
 */
export function postgresSourceReplayStore(pool: SqlPool): SourceReplayStore {
  return {
    async exclusive(scope, work) {
      const key = scopeKey(scope);
      const client = await pool.connect();
      let locked = false, discard = false;
      try {
        const lock = await client.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock(hashtextextended($1, 12)) AS acquired', [key]);
        locked = lock.rows[0]?.acquired === true;
        if (!locked) throw new Error('Source replay is already active.');
        return await work({
          async read() {
            const result = await client.query<{ checkpoint: ReplayCheckpoint }>(
              'SELECT checkpoint FROM source_ingestion.replay_checkpoints WHERE scope_key=$1', [key]);
            return result.rows[0]?.checkpoint ?? null;
          },
          async save(checkpoint) {
            if (scopeKey(checkpoint.request) !== key) throw new Error('Replay checkpoint scope mismatch.');
            await client.query(`INSERT INTO source_ingestion.replay_checkpoints(scope_key,checkpoint)
              VALUES ($1,$2::jsonb) ON CONFLICT (scope_key) DO UPDATE
              SET checkpoint=EXCLUDED.checkpoint,updated_at=clock_timestamp()`, [key, JSON.stringify(checkpoint)]);
          },
        });
      } finally {
        if (locked) {
          try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 12))', [key]); }
          catch { discard = true; }
        }
        client.release(discard);
      }
    },
  };
}
