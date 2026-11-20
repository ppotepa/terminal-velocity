import type { SqlExecutor } from '../../../../contracts/database/index.ts';
import type { ReplayRequestReader } from '../../ports/replay-request-reader.ts';

export function postgresReplayRequestReader(sql: SqlExecutor): ReplayRequestReader {
  return { async list(afterId, limit) {
    if (!Number.isSafeInteger(afterId) || afterId < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500)
      throw new RangeError('Invalid replay request page.');
    const result = await sql.query<{ request_id: string; assertion_id: string;
      kind: 'ICAO24' | 'REGISTRATION'; normalized_alias: string;
      valid_from_ms: string; valid_until_ms: string | null }>(`
      SELECT request_id,assertion_id,kind,normalized_alias,valid_from_ms,valid_until_ms
      FROM fleet_identity.replay_requests WHERE request_id > $1 ORDER BY request_id LIMIT $2`,
    [afterId, limit]);
    return result.rows.map(row => ({ requestId: Number(row.request_id), assertionId: Number(row.assertion_id),
      kind: row.kind, normalizedAlias: row.normalized_alias, validFrom: Number(row.valid_from_ms),
      validUntil: row.valid_until_ms === null ? null : Number(row.valid_until_ms) }));
  } };
}
