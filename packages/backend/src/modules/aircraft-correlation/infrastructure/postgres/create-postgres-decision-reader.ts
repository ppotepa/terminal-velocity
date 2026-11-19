import type { SqlExecutor } from '../../../../contracts/database/index.ts';
import type { DecisionReader } from '../../ports/decision-reader.ts';
import { decisionColumns, decodeDecisionRow, type DecisionRow } from './decision-row.ts';

export function createPostgresDecisionReader(sql: SqlExecutor): DecisionReader {
  return {
    async readCurrent(messageId) {
      const result = await sql.query<DecisionRow>(`SELECT ${decisionColumns}
        FROM correlation.aircraft_link_heads h
        JOIN correlation.aircraft_link_revisions r
          ON r.message_id = h.message_id AND r.revision = h.revision
        WHERE h.message_id = $1`, [messageId]);
      const row = result.rows[0];
      return row === undefined ? null : decodeDecisionRow(row);
    },
    async readHistory(messageId) {
      const result = await sql.query<DecisionRow>(`SELECT ${decisionColumns}
        FROM correlation.aircraft_link_revisions r
        WHERE r.message_id = $1 ORDER BY r.revision ASC`, [messageId]);
      return result.rows.map(decodeDecisionRow);
    },
  };
}
