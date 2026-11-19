import type { SqlExecutor, SqlPool } from '../../../contracts/database/index.ts';

/** One checked-out connection owns the complete transaction and is always released. */
export async function runSqlTransaction<T>(pool: SqlPool, work: (sql: SqlExecutor) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let active = false, discard = false, failed = false;
  let inFlight = 0;
  const sql: SqlExecutor = {
    async query<Row extends Record<string, unknown>>(text: string, values?: unknown[]) {
      if (!active) throw new Error('The SQL transaction capability has expired.');
      inFlight += 1;
      try { return await client.query<Row>(text, values); }
      catch (error) { failed = true; throw error; }
      finally { inFlight -= 1; }
    },
  };
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    active = true;
    let result: T;
    try { result = await work(sql); }
    finally { active = false; }
    if (inFlight !== 0) throw new Error('The transaction callback returned with SQL statements still in flight.');
    if (failed) throw new Error('A failed SQL statement prevents this transaction from committing.');
    await client.query('COMMIT');
    return result;
  } catch (error) {
    active = false;
    try { await client.query('ROLLBACK'); }
    catch { discard = true; }
    throw error;
  } finally {
    client.release(discard);
  }
}
