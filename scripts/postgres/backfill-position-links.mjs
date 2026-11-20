import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

/** Queue at most one keyset page per transaction. The trigger handles concurrent inserts. */
export async function backfillPositionLinks(pool, { batchSize = 500, maxBatches = Infinity } = {}) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw new RangeError('Batch size must be between 1 and 1000.');
  if (maxBatches !== Infinity && (!Number.isSafeInteger(maxBatches) || maxBatches < 1))
    throw new RangeError('Maximum batches must be positive.');
  let queued = 0;
  let complete = false;
  for (let batch = 0; batch < maxBatches; batch++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const progress = (await client.query(`SELECT last_source_id,last_source_observation_id,completed_at
        FROM fleet_identity.position_backfill_progress WHERE singleton FOR UPDATE`)).rows[0];
      if (!progress) throw new Error('Position backfill progress is missing. Apply migrations first.');
      if (progress.completed_at) {
        complete = true;
        await client.query('COMMIT');
        break;
      }
      const rows = (await client.query(`SELECT source_id,source_observation_id
        FROM tracking.position_observations
        WHERE ($1::text IS NULL OR (source_id,source_observation_id) > ($1,$2))
        ORDER BY source_id,source_observation_id LIMIT $3`,
      [progress.last_source_id, progress.last_source_observation_id, batchSize])).rows;
      if (rows.length) {
        const values = rows.map((_, index) => `($${index * 2 + 1},$${index * 2 + 2})`).join(',');
        const inserted = await client.query(`INSERT INTO fleet_identity.position_link_jobs
          (source_id,source_observation_id)
          SELECT v.source_id,v.source_observation_id FROM (VALUES ${values}) AS v(source_id,source_observation_id)
          WHERE NOT EXISTS (SELECT 1 FROM fleet_identity.position_link_heads h
            WHERE h.source_id=v.source_id AND h.source_observation_id=v.source_observation_id)
          ON CONFLICT DO NOTHING`,
        rows.flatMap(row => [row.source_id, row.source_observation_id]));
        queued += inserted.rowCount;
        const last = rows.at(-1);
        await client.query(`UPDATE fleet_identity.position_backfill_progress
          SET last_source_id=$1,last_source_observation_id=$2 WHERE singleton`,
        [last.source_id, last.source_observation_id]);
      }
      if (rows.length < batchSize) {
        await client.query(`UPDATE fleet_identity.position_backfill_progress
          SET completed_at=clock_timestamp() WHERE singleton`);
        complete = true;
      }
      await client.query('COMMIT');
      if (complete) break;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return { queued, complete };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.MIGRATION_DATABASE_URL) {
    console.error('MIGRATION_DATABASE_URL is required for the position backfill.');
    process.exitCode = 1;
  } else {
    const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1,
      connectionTimeoutMillis: 5000, application_name: 'terminal-velocity-position-backfill' });
    try {
      const result = await backfillPositionLinks(pool);
      console.log(`Position backfill queued ${result.queued} facts; complete=${result.complete}.`);
    } catch (error) {
      console.error(`Position backfill failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  }
}
