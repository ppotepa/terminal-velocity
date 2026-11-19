import type { SqlExecutor } from '../../../../contracts/database/index.ts';
import type { MessageId } from '../../../../contracts/identity/index.ts';

export async function lockMessage(sql: SqlExecutor, messageId: MessageId): Promise<void> {
  // Lock before a separate READ COMMITTED read, including when no head exists.
  // A hash collision only serializes unrelated keys; it cannot merge their data.
  await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
    [`correlation/aircraft-link/${messageId}`]);
}
