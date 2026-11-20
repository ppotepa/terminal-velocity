import type { SqlExecutor, SqlPool } from '../../../../contracts/database/index.ts';
import { runSqlTransaction } from '../../../database-transactions/public/index.ts';
import { measurementRank } from '../../domain/compare-position-evidence.ts';
import { parseStoredPositionObservation, type PositionObservation } from '../../domain/position-observation.ts';

type Priority = (sourceId: string) => number;
type FactRow = { observation_id: string; source_id: string; source_observation_id: string;
  observed_at_ms: string; fact: unknown; aircraft_id: string; revision: string };

function checkedPriority(priority: Priority, sourceId: string): number {
  const value = priority(sourceId);
  if (!Number.isSafeInteger(value) || value < -1_000_000 || value > 1_000_000)
    throw new RangeError('Invalid configured position source priority.');
  return value;
}

function candidateValues(row: FactRow, priority: Priority): unknown[] {
  const parsed = parseStoredPositionObservation(row.fact);
  if (!parsed.ok) throw new Error('Stored position fact failed validation.');
  const fact: PositionObservation = parsed.value;
  return [row.source_id, row.source_observation_id, row.observation_id, row.aircraft_id,
    row.revision, row.observed_at_ms, fact.quality?.nic ?? null, fact.quality?.nacP ?? null,
    fact.quality?.containmentRadiusMeters ?? null, measurementRank(fact.measurementKind),
    checkedPriority(priority, row.source_id)];
}

async function insertCandidate(sql: SqlExecutor, row: FactRow, priority: Priority): Promise<void> {
  await sql.query(`INSERT INTO tracking.current_position_candidates
    (source_id,source_observation_id,observation_id,aircraft_id,link_revision,observed_at_ms,
     nic,nac_p,containment_radius_m,measurement_rank,source_priority)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (source_id,source_observation_id) DO UPDATE SET
      observation_id=EXCLUDED.observation_id,aircraft_id=EXCLUDED.aircraft_id,
      link_revision=EXCLUDED.link_revision,observed_at_ms=EXCLUDED.observed_at_ms,
      nic=EXCLUDED.nic,nac_p=EXCLUDED.nac_p,
      containment_radius_m=EXCLUDED.containment_radius_m,
      measurement_rank=EXCLUDED.measurement_rank,source_priority=EXCLUDED.source_priority`,
  candidateValues(row, priority));
}

async function refreshAircraft(sql: SqlExecutor, aircraftId: string): Promise<void> {
  const selected = await sql.query<{ source_id: string; source_observation_id: string }>(`
    SELECT source_id,source_observation_id FROM tracking.current_position_candidates
    WHERE aircraft_id=$1 ORDER BY observed_at_ms DESC,nic DESC NULLS LAST,
      nac_p DESC NULLS LAST,containment_radius_m ASC NULLS LAST,
      measurement_rank DESC,source_priority DESC,source_id,observation_id LIMIT 1`, [aircraftId]);
  const best = selected.rows[0] ?? null;
  const previous = await sql.query<{ revision: string; source_id: string | null;
    source_observation_id: string | null }>(`SELECT revision,source_id,source_observation_id
      FROM tracking.current_position_heads WHERE aircraft_id=$1`, [aircraftId]);
  const old = previous.rows[0];
  if (!best && !old) return;
  if (old?.source_id === (best?.source_id ?? null)
    && old.source_observation_id === (best?.source_observation_id ?? null)) return;
  await sql.query(`INSERT INTO tracking.current_position_heads
    (aircraft_id,revision,source_id,source_observation_id)
    VALUES ($1,$2,$3,$4) ON CONFLICT (aircraft_id) DO UPDATE SET
      revision=EXCLUDED.revision,source_id=EXCLUDED.source_id,
      source_observation_id=EXCLUDED.source_observation_id,calculated_at=clock_timestamp()`,
  [aircraftId, Number(old?.revision ?? 0) + 1, best?.source_id ?? null,
    best?.source_observation_id ?? null]);
}

/** The caller owns one projection transaction and the singleton serialization lock. */
export async function applyPositionLinkProjection(sql: SqlExecutor, sourceId: string,
  sourceObservationId: string, linkRevision: number, priority: Priority): Promise<'APPLIED' | 'SUPERSEDED'> {
  const current = await sql.query<FactRow & { status: string }>(`SELECT p.observation_id,
    p.source_id,p.source_observation_id,p.observed_at_ms,p.fact,
    r.aircraft_id,r.revision,r.status FROM fleet_identity.position_link_heads h
    JOIN fleet_identity.position_link_revisions r
      USING (source_id,source_observation_id,revision)
    JOIN tracking.position_observations p USING (source_id,source_observation_id)
    WHERE h.source_id=$1 AND h.source_observation_id=$2`, [sourceId, sourceObservationId]);
  const head = current.rows[0];
  if (!head) throw new Error('Position link head is missing.');
  if (Number(head.revision) !== linkRevision) return 'SUPERSEDED';
  const previous = await sql.query<{ aircraft_id: string }>(`SELECT aircraft_id
    FROM tracking.current_position_candidates WHERE source_id=$1 AND source_observation_id=$2`,
  [sourceId, sourceObservationId]);
  const priorAircraft = previous.rows[0]?.aircraft_id ?? null;
  await sql.query(`DELETE FROM tracking.current_position_candidates
    WHERE source_id=$1 AND source_observation_id=$2`, [sourceId, sourceObservationId]);
  const nextAircraft = head.status === 'MATCHED' ? head.aircraft_id : null;
  if (nextAircraft) await insertCandidate(sql, head, priority);
  if (priorAircraft) await refreshAircraft(sql, priorAircraft);
  if (nextAircraft && nextAircraft !== priorAircraft) await refreshAircraft(sql, nextAircraft);
  return 'APPLIED';
}

/** Inbox, projection effects and job acknowledgment commit or roll back together. */
export function createCurrentPositionWorker(pool: SqlPool, priority: Priority = () => 0) {
  return async (): Promise<'APPLIED' | 'SUPERSEDED' | 'DUPLICATE' | null> =>
    runSqlTransaction(pool, async sql => {
      const state = await sql.query(`SELECT singleton FROM tracking.current_position_state
        WHERE singleton FOR UPDATE`);
      if (!state.rows[0]) throw new Error('Current-position projection state is missing.');
      const jobs = await sql.query<{ job_id: string; source_id: string;
        source_observation_id: string; link_revision: string }>(`SELECT job_id,source_id,
        source_observation_id,link_revision FROM tracking.current_position_jobs
        WHERE completed_at IS NULL ORDER BY job_id FOR UPDATE SKIP LOCKED LIMIT 1`);
      const job = jobs.rows[0];
      if (!job) return null;
      const inbox = await sql.query(`INSERT INTO tracking.current_position_inbox (job_id)
        VALUES ($1) ON CONFLICT DO NOTHING RETURNING job_id`, [job.job_id]);
      const result = inbox.rowCount === 1
        ? await applyPositionLinkProjection(sql, job.source_id, job.source_observation_id,
          Number(job.link_revision), priority) : 'DUPLICATE';
      await sql.query(`UPDATE tracking.current_position_jobs SET completed_at=clock_timestamp()
        WHERE job_id=$1`, [job.job_id]);
      return result;
    });
}

/** Rebuild a single aircraft from versioned links and immutable observations. */
export function createCurrentPositionRebuilder(pool: SqlPool, priority: Priority = () => 0) {
  return async (aircraftId: string, from: number, until: number): Promise<number> => {
    if (!/^ac_[a-zA-Z0-9-]{1,64}$/.test(aircraftId)
      || !Number.isSafeInteger(from) || from < 0 || !Number.isSafeInteger(until)
      || until <= from || until - from > 86_400_000)
      throw new RangeError('Invalid bounded current-position rebuild.');
    return runSqlTransaction(pool, async sql => {
      const state = await sql.query(`SELECT singleton FROM tracking.current_position_state
        WHERE singleton FOR UPDATE`);
      if (!state.rows[0]) throw new Error('Current-position projection state is missing.');
      const facts = await sql.query<FactRow>(`SELECT p.observation_id,p.source_id,
        p.source_observation_id,p.observed_at_ms,p.fact,r.aircraft_id,r.revision
        FROM tracking.position_observations p
        JOIN fleet_identity.position_link_heads h USING (source_id,source_observation_id)
        JOIN fleet_identity.position_link_revisions r USING (source_id,source_observation_id,revision)
        WHERE r.status='MATCHED' AND r.aircraft_id=$1
          AND p.observed_at_ms >= $2 AND p.observed_at_ms < $3
        ORDER BY p.observed_at_ms,p.source_id,p.source_observation_id LIMIT 501`,
      [aircraftId, from, until]);
      if (facts.rows.length > 500) throw new RangeError('Current-position rebuild range exceeds 500 facts.');
      await sql.query(`DELETE FROM tracking.current_position_candidates
        WHERE aircraft_id=$1 AND observed_at_ms >= $2 AND observed_at_ms < $3`,
      [aircraftId, from, until]);
      for (const fact of facts.rows) await insertCandidate(sql, fact, priority);
      await refreshAircraft(sql, aircraftId);
      return facts.rows.length;
    });
  };
}
