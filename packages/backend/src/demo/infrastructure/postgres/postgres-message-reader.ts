import type { SqlExecutor } from '../../../contracts/database/index.ts';
import type { MessageReader } from '../../ports/message-reader.ts';
import { decodeMessageRow, messageColumns, messageJoins } from './decode-message-row.ts';

/** Retention is durable; a single HTTP list response remains bounded to 500 records. */
export function createPostgresMessageReader(sql: SqlExecutor): MessageReader {
  return {
    async readMessage(id) {
      const result = await sql.query(`SELECT ${messageColumns} ${messageJoins} WHERE m.message_id = $1`, [id]);
      const row = result.rows[0];
      return row ? decodeMessageRow(row) : null;
    },
    async readAircraftMessages(id) {
      const result = await sql.query(`SELECT ${messageColumns} ${messageJoins}
        WHERE r.decision->>'status' = 'MATCHED' AND r.decision->>'aircraftId' = $1
        ORDER BY m.observed_at_ms DESC, m.message_id ASC LIMIT 500`, [id]);
      return result.rows.map(decodeMessageRow);
    },
  };
}
