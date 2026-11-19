import type { SqlExecutor } from '../../../contracts/database/index.ts';
import type { ContributionWriter } from '../ports/contribution-writer.ts';
import { ContributionRevisionCollision } from './contribution-revision-collision.ts';
import { snapshotContribution } from './contribution-row.ts';
import { readPostgresInteger } from './read-postgres-integer.ts';

interface StoredContributionRow extends Record<string, unknown> {
  revision: unknown;
  aircraft_id: unknown;
  observed_at_ms: unknown;
  bearer: unknown;
}

/** Use the active consumer transaction, so row locks survive through inbox/effect commit. */
export function createPostgresContributionWriter(sql: SqlExecutor): ContributionWriter {
  return {
    async apply(change) {
      // Snapshot every primitive before the first asynchronous operation.
      const next = snapshotContribution(change);
      const written = await sql.query(`
        INSERT INTO availability.contributions (message_id, revision, aircraft_id, observed_at_ms, bearer)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (message_id) DO UPDATE
          SET revision = EXCLUDED.revision, aircraft_id = EXCLUDED.aircraft_id,
              observed_at_ms = EXCLUDED.observed_at_ms, bearer = EXCLUDED.bearer
          WHERE availability.contributions.revision < EXCLUDED.revision
        RETURNING message_id`,
      [next.messageId, next.revision, next.aircraftId, next.observedAt, next.bearer]);
      if (written.rowCount === 1) return 'APPLIED';
      // ON CONFLICT locks even a row rejected by its WHERE clause until the outer commit.
      const selected = await sql.query<StoredContributionRow>(`
        SELECT revision, aircraft_id, observed_at_ms, bearer
        FROM availability.contributions WHERE message_id = $1`, [next.messageId]);
      const current = selected.rows[0];
      if (!current) throw new Error('The locked contribution is missing.');
      const currentRevision = readPostgresInteger(current.revision, 1);
      if (currentRevision > next.revision) return 'IGNORED';
      if (currentRevision < next.revision) throw new Error('The contribution revision was not serialized.');
      const currentObservedAt = current.observed_at_ms === null ? null : readPostgresInteger(current.observed_at_ms, 0);
      if (current.aircraft_id !== next.aircraftId || currentObservedAt !== next.observedAt || current.bearer !== next.bearer)
        throw new ContributionRevisionCollision();
      return 'IGNORED';
    },
  };
}
