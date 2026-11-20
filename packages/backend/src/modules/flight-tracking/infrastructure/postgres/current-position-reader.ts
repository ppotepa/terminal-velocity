import type { SqlPool } from '../../../../contracts/database/index.ts';
import { aircraftId as parseAircraftId } from '../../../../contracts/identity/aircraft-id.ts';
import { classifyPositionFreshness, positionFreshnessPolicy } from '../../domain/position-freshness.ts';
import { parseStoredPositionObservation } from '../../domain/position-observation.ts';
import { utcTimestamp } from '../../domain/position-time.ts';
import type { CurrentPositionReader } from '../../ports/current-position-reader.ts';

export function postgresCurrentPositionReader(pool: SqlPool): CurrentPositionReader {
  return { async read(id, now, policy) {
    const checkedId = parseAircraftId(id);
    const checkedNow = utcTimestamp(now, 'ingestedAt');
    const checkedPolicy = positionFreshnessPolicy(policy);
    if (!checkedId.ok || !checkedNow.ok || !checkedPolicy.ok)
      throw new RangeError('Invalid current-position read.');
    const result = await pool.query<{ revision: string; calculated_at: Date;
      fact: unknown | null }>(`SELECT h.revision,h.calculated_at,p.fact
      FROM tracking.current_position_heads h
      LEFT JOIN tracking.position_observations p
        ON p.source_id=h.source_id AND p.source_observation_id=h.source_observation_id
      WHERE h.aircraft_id=$1`, [checkedId.value]);
    const row = result.rows[0];
    if (!row) return { aircraftId: checkedId.value, revision: 0,
      freshness: 'UNKNOWN', observation: null, calculatedAt: null };
    let observation = null;
    if (row.fact !== null) {
      const parsed = parseStoredPositionObservation(row.fact);
      if (!parsed.ok) throw new Error('Stored current position failed validation.');
      observation = parsed.value;
    }
    return { aircraftId: checkedId.value, revision: Number(row.revision),
      freshness: classifyPositionFreshness(observation, checkedNow.value, checkedPolicy.value),
      observation, calculatedAt: row.calculated_at.toISOString() };
  } };
}
