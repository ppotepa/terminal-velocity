import type { SqlExecutor } from '../../../../contracts/database/index.ts';
import type { Revision } from '../../../../contracts/identity/index.ts';
import type { StoredDecision } from '../../application/stored-decision.ts';

export async function writeDecisionRevision(
  sql: SqlExecutor, decision: StoredDecision, previousRevision: Revision | null,
): Promise<void> {
  const id = decision.decision.messageId;
  await sql.query(`INSERT INTO correlation.aircraft_link_revisions
    (message_id, revision, decided_at_ms, directory_revision, decision)
    VALUES ($1, $2, $3, $4, $5::jsonb)`,
  [id, decision.revision, decision.decidedAt, decision.directoryRevision, JSON.stringify(decision.decision)]);
  const head = previousRevision === null
    ? await sql.query(`INSERT INTO correlation.aircraft_link_heads (message_id, revision)
        VALUES ($1, $2)`, [id, decision.revision])
    : await sql.query(`UPDATE correlation.aircraft_link_heads SET revision = $2
        WHERE message_id = $1 AND revision = $3`, [id, decision.revision, previousRevision]);
  if (head.rowCount !== 1) throw new Error('The locked decision head changed unexpectedly.');
}
