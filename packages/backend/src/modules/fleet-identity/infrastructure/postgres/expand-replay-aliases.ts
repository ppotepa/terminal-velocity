import type { SqlExecutor } from '../../../../contracts/database/index.ts';

/** One durable keyset page. Caller owns the transaction and scheduler lock. */
export async function expandReplayAliases(sql: SqlExecutor, limit: number): Promise<{ requestId: number; processed: number; complete: boolean } | null> {
  const task = (await sql.query<{ expansion_id: string; assertion_id: string; aircraft_id: string;
    valid_from_ms: string; valid_until_ms: string | null; cursor_assertion_id: string }>(`
    SELECT expansion_id,assertion_id,aircraft_id,valid_from_ms,valid_until_ms,cursor_assertion_id
    FROM fleet_identity.replay_expansions WHERE completed_at IS NULL ORDER BY expansion_id
    FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
  if (!task) return null;
  const rows = await sql.query<{ assertion_id: string; kind: string; normalized_alias: string;
    valid_from_ms: string; valid_until_ms: string | null }>(`
    SELECT a.assertion_id,a.kind,a.normalized_alias,a.valid_from_ms,a.valid_until_ms
    FROM fleet_identity.assertions a WHERE a.aircraft_id=$1 AND a.assertion_id > $2
      AND a.assertion_id < $6
      AND NOT EXISTS (SELECT 1 FROM fleet_identity.assertions s WHERE s.supersedes_id=a.assertion_id)
      AND a.valid_from_ms < COALESCE($3::bigint, 9223372036854775807)
      AND COALESCE(a.valid_until_ms, 9223372036854775807) > $4
    ORDER BY a.assertion_id LIMIT $5`,
  [task.aircraft_id, task.cursor_assertion_id, task.valid_until_ms, task.valid_from_ms, limit, task.assertion_id]);
  for (const row of rows.rows) await sql.query(`INSERT INTO fleet_identity.replay_requests
    (assertion_id,kind,normalized_alias,valid_from_ms,valid_until_ms) VALUES ($1,$2,$3,$4,$5)`,
  [task.assertion_id, row.kind, row.normalized_alias, row.valid_from_ms, row.valid_until_ms]);
  const last = rows.rows.at(-1);
  if (last) await sql.query(`UPDATE fleet_identity.replay_expansions SET cursor_assertion_id=$2
    WHERE expansion_id=$1`, [task.expansion_id, last.assertion_id]);
  if (rows.rows.length < limit) await sql.query(`UPDATE fleet_identity.replay_expansions
    SET completed_at=clock_timestamp() WHERE expansion_id=$1`, [task.expansion_id]);
  return { requestId: Number(task.expansion_id), processed: rows.rows.length, complete: rows.rows.length < limit };
}
