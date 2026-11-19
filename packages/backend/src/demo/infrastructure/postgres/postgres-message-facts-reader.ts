import type { SqlExecutor } from '../../../contracts/database/index.ts';
import type { MessageFactsReader } from '../../ports/message-facts-reader.ts';
import { decodeCanonicalMessage } from './decode-canonical-message.ts';
export function createPostgresMessageFactsReader(sql: SqlExecutor): MessageFactsReader {
  return {
    async readFacts(id) {
      const result = await sql.query('SELECT canonical FROM message_ingestion.messages WHERE message_id = $1', [id]);
      const row = result.rows[0];
      return row ? decodeCanonicalMessage(row['canonical'], id) : null;
    },
  };
}
