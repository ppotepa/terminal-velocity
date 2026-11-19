import type { SqlExecutor } from '../../../contracts/database/index.ts';
import { aircraftId, type AircraftId } from '../../../contracts/identity/index.ts';
import { epochMillis, type EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { AvailabilityReader } from '../ports/availability-reader.ts';
import { readPostgresInteger } from './read-postgres-integer.ts';

interface AvailabilityRow extends Record<string, unknown> {
  aircraft_id: unknown;
  last_observed_at_ms: unknown;
}

export function createPostgresAvailabilityReader(sql: SqlExecutor): AvailabilityReader {
  return {
    async lastMessageTimes() {
      const selected = await sql.query<AvailabilityRow>(`
        SELECT aircraft_id, max(observed_at_ms)::text AS last_observed_at_ms
        FROM availability.contributions
        WHERE aircraft_id IS NOT NULL
        GROUP BY aircraft_id`);
      const latest = new Map<AircraftId, EpochMillis>();
      for (const row of selected.rows) {
        const id = typeof row.aircraft_id === 'string' ? aircraftId(row.aircraft_id) : null;
        if (!id?.ok) throw new TypeError('The stored availability aircraft ID is invalid.');
        const time = epochMillis(readPostgresInteger(row.last_observed_at_ms, 0));
        if (!time.ok) throw new TypeError('The stored availability observation time is invalid.');
        latest.set(id.value, time.value);
      }
      return latest;
    },
  };
}
