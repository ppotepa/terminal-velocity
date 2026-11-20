import type { SqlPool } from '../../../../contracts/database/index.ts';
import { runSqlTransaction } from '../../../database-transactions/public/index.ts';

/** Queue one durable keyset page of preexisting identity links. New links use the trigger. */
export async function backfillCurrentPositionLinks(pool: SqlPool, limit = 500):
  Promise<{ queued: number; complete: boolean }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
    throw new RangeError('Invalid current-position backfill page size.');
  return runSqlTransaction(pool, async sql => {
    const progress = await sql.query<{ last_source_id: string | null;
      last_source_observation_id: string | null; completed_at: Date | null }>(`
      SELECT last_source_id,last_source_observation_id,completed_at
      FROM tracking.current_position_backfill_progress WHERE singleton FOR UPDATE`);
    const state = progress.rows[0];
    if (!state) throw new Error('Current-position backfill progress is missing.');
    if (state.completed_at) return { queued: 0, complete: true };
    const page = await sql.query<{ source_id: string; source_observation_id: string;
      revision: string }>(`SELECT source_id,source_observation_id,revision
      FROM fleet_identity.position_link_heads
      WHERE ($1::text IS NULL OR (source_id,source_observation_id) > ($1,$2))
      ORDER BY source_id,source_observation_id LIMIT $3`,
    [state.last_source_id, state.last_source_observation_id, limit]);
    let queued = 0;
    for (const row of page.rows) {
      const inserted = await sql.query(`INSERT INTO tracking.current_position_jobs
        (source_id,source_observation_id,link_revision) VALUES ($1,$2,$3)
        ON CONFLICT DO NOTHING`, [row.source_id, row.source_observation_id, row.revision]);
      queued += inserted.rowCount ?? 0;
    }
    const last = page.rows.at(-1);
    if (last) await sql.query(`UPDATE tracking.current_position_backfill_progress
      SET last_source_id=$1,last_source_observation_id=$2 WHERE singleton`,
    [last.source_id, last.source_observation_id]);
    const complete = page.rows.length < limit;
    if (complete) await sql.query(`UPDATE tracking.current_position_backfill_progress
      SET completed_at=clock_timestamp() WHERE singleton`);
    return { queued, complete };
  });
}
