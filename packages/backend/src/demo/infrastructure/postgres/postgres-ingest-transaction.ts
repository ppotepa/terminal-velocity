import type { SqlExecutor, SqlPool } from '../../../contracts/database/index.ts';
import type { DecisionTransaction, DecisionWriteSet } from '../../../modules/aircraft-correlation/public/index.ts';
import { runSqlTransaction } from '../../../modules/database-transactions/public/index.ts';
import type { IngestTransaction } from '../../ports/ingest-transaction.ts';
import { createPostgresMessageReader } from './postgres-message-reader.ts';

export interface BoundDecisionSession { readonly read: DecisionWriteSet['read']; readonly run: DecisionTransaction['run']; }

export function createPostgresIngestTransaction(pool: SqlPool,
  bindDecisions: (sql: SqlExecutor) => BoundDecisionSession): IngestTransaction {
  return {
    run: (messageId, work) => runSqlTransaction(pool, async sql => {
      const decisions = bindDecisions(sql);
      await decisions.read(messageId);
      const reader = createPostgresMessageReader(sql);
      return work({
        readMessage: () => reader.readMessage(messageId),
        async insertMessage(message, receivedAt) {
          if (message.messageId !== messageId) throw new Error('The message identity is outside this transaction.');
          await sql.query(`INSERT INTO message_ingestion.messages
            (message_id, canonical, observed_at_ms, received_at_ms) VALUES ($1, $2::jsonb, $3, $4)`,
          [messageId, JSON.stringify(message), message.observedAt, receivedAt]);
        },
        decisions: { run: decisions.run },
      });
    }),
  };
}
