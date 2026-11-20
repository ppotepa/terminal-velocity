import type { SqlPool } from '../../../../contracts/database/index.ts';
import { runSqlTransaction } from '../../../database-transactions/public/index.ts';
import { icao24, type StrongIdentifier } from '../../../aircraft-correlation/public/index.ts';
import { resolveIdentityAt } from '../../domain/resolve-identity-at.ts';
import type { PositionLinkDecision, PositionLinker } from '../../ports/position-linker.ts';
import { postgresIdentityReader } from './postgres-identity-reader.ts';

export function postgresPositionLinker(pool: SqlPool): PositionLinker {
  async function reevaluate(sourceId: string, sourceObservationId: string): Promise<PositionLinkDecision> {
    return runSqlTransaction(pool, async sql => {
      await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [JSON.stringify([sourceId, sourceObservationId])]);
      await sql.query('SELECT revision FROM fleet_identity.registry_state WHERE singleton FOR SHARE');
      const found = await sql.query<{ fact: { observedAt?: string; identifierHints?: { icao24?: string };
        confirmedAircraftId?: string } }>(`SELECT fact FROM tracking.position_observations
        WHERE source_id=$1 AND source_observation_id=$2`, [sourceId, sourceObservationId]);
      const fact = found.rows[0]?.fact;
      if (!fact) throw new Error('Position observation does not exist.');
      const observedAt = Date.parse(fact.observedAt ?? '');
      if (!Number.isSafeInteger(observedAt)) throw new Error('Stored position time is invalid.');
      const parsed = fact.identifierHints?.icao24 ? icao24(fact.identifierHints.icao24) : null;
      if (parsed && !parsed.ok) throw new Error('Stored ICAO24 hint is invalid.');
      const identifiers: StrongIdentifier[] = parsed?.ok ? [{ kind: 'ICAO24', value: parsed.value }] : [];
      const snapshot = await postgresIdentityReader(sql).find(identifiers, observedAt);
      let resolution = resolveIdentityAt(identifiers, observedAt, snapshot.assertions, snapshot.revision,
        snapshot.completeness === 'COMPLETE');
      if (fact.confirmedAircraftId && resolution.status === 'UNMATCHED') {
        const known = await sql.query('SELECT 1 FROM fleet_identity.aircraft WHERE aircraft_id=$1', [fact.confirmedAircraftId]);
        if (known.rowCount === 1) resolution = { status: 'MATCHED',
          aircraftId: fact.confirmedAircraftId as NonNullable<PositionLinkDecision['aircraftId']>,
          revision: snapshot.revision };
      }
      // A prior independent confirmation cannot silently be replaced by a conflicting registry claim.
      if (fact.confirmedAircraftId && resolution.status === 'MATCHED'
        && resolution.aircraftId !== fact.confirmedAircraftId)
        resolution = { status: 'CONFLICTED', candidateIds: [resolution.aircraftId,
          fact.confirmedAircraftId as typeof resolution.aircraftId].sort(), revision: snapshot.revision };
      const head = await sql.query<{ revision: string; registry_revision: string; status: PositionLinkDecision['status'];
        aircraft_id: string | null }>(`SELECT r.revision,r.registry_revision,r.status,r.aircraft_id
        FROM fleet_identity.position_link_heads h JOIN fleet_identity.position_link_revisions r
        USING (source_id,source_observation_id,revision) WHERE h.source_id=$1 AND h.source_observation_id=$2`,
      [sourceId, sourceObservationId]);
      const previous = head.rows[0];
      const aircraftId = resolution.status === 'MATCHED' ? resolution.aircraftId : null;
      if (previous && Number(previous.registry_revision) === snapshot.revision
        && previous.status === resolution.status && previous.aircraft_id === aircraftId)
        return { sourceId, sourceObservationId, revision: Number(previous.revision),
          registryRevision: snapshot.revision, status: resolution.status, aircraftId };
      const revision = Number(previous?.revision ?? 0) + 1;
      await sql.query(`INSERT INTO fleet_identity.position_link_revisions
        (source_id,source_observation_id,revision,registry_revision,status,aircraft_id,candidate_ids)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [sourceId, sourceObservationId, revision,
        snapshot.revision, resolution.status, aircraftId,
        'candidateIds' in resolution ? resolution.candidateIds : []]);
      await sql.query(`INSERT INTO fleet_identity.position_link_heads (source_id,source_observation_id,revision)
        VALUES ($1,$2,$3) ON CONFLICT (source_id,source_observation_id)
        DO UPDATE SET revision=EXCLUDED.revision`, [sourceId, sourceObservationId, revision]);
      return { sourceId, sourceObservationId, revision, registryRevision: snapshot.revision,
        status: resolution.status, aircraftId };
    });
  }
  return { reevaluate, async replayAlias(alias, from, until, limit, after) {
    const parsed = icao24(alias);
    if (!parsed.ok || !Number.isSafeInteger(from) || from < 0 || (until !== null &&
      (!Number.isSafeInteger(until) || until <= from)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 500
      || (after !== undefined && (!Number.isSafeInteger(after.observedAt) || after.observedAt < from
        || (until !== null && after.observedAt >= until) || typeof after.sourceId !== 'string'
        || typeof after.sourceObservationId !== 'string')))
      throw new RangeError('Invalid bounded alias replay.');
    const result = await pool.query<{ observed_at_ms: string; source_id: string; source_observation_id: string }>(`
      SELECT observed_at_ms,source_id,source_observation_id FROM tracking.position_observations
      WHERE icao24_hint=$1 AND observed_at_ms >= $2 AND ($3::bigint IS NULL OR observed_at_ms < $3)
        AND ($4::bigint IS NULL OR (observed_at_ms,source_id,source_observation_id) > ($4,$5,$6))
      ORDER BY observed_at_ms,source_id,source_observation_id LIMIT $7`,
    [parsed.value, from, until, after?.observedAt ?? null, after?.sourceId ?? null,
      after?.sourceObservationId ?? null, limit + 1]);
    const page = result.rows.slice(0, limit);
    const decisions = [];
    for (const row of page) decisions.push(await reevaluate(row.source_id, row.source_observation_id));
    const last = page.at(-1);
    return { decisions, next: result.rows.length > limit && last ? {
      observedAt: Number(last.observed_at_ms), sourceId: last.source_id,
      sourceObservationId: last.source_observation_id } : null };
  } };
}
