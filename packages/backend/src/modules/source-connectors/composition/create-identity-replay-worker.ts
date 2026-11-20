import { randomUUID } from 'node:crypto';
import type { SqlPool } from '../../../contracts/database/index.ts';
import { eventId, messageId } from '../../../contracts/identity/index.ts';
import { epochMillis } from '../../../kernel/time/epoch-millis.ts';
import { runSqlTransaction } from '../../database-transactions/public/index.ts';
import { createCorrelateMessage, icao24, registration, type StrongIdentifier } from '../../aircraft-correlation/public/index.ts';
import { createPostgresDecisionReader } from '../../aircraft-correlation/infrastructure/postgres/create-postgres-decision-reader.ts';
import { createPostgresDecisionWriteSet } from '../../aircraft-correlation/infrastructure/postgres/create-postgres-decision-write-set.ts';
import { runDecisionWork } from '../../aircraft-correlation/infrastructure/postgres/run-decision-work.ts';
import { createRegistryCandidateDirectory } from '../../fleet-identity/public/index.ts';
import { postgresIdentityReader } from '../../fleet-identity/infrastructure/postgres/postgres-identity-reader.ts';
import { postgresPositionLinker } from '../../fleet-identity/infrastructure/postgres/postgres-position-linker.ts';

interface RequestRow {
  [key: string]: unknown;
  request_id: string; kind: 'ICAO24' | 'REGISTRATION'; normalized_alias: string;
  valid_from_ms: string; valid_until_ms: string | null; phase: 'POSITIONS' | 'MESSAGES';
  cursor_time_ms: string | null; cursor_source_id: string | null;
  cursor_observation_id: string | null; cursor_message_id: string | null;
}

/** One locked, bounded page per call. A failed page leaves its cursor unchanged for retry. */
export function createIdentityReplayWorker(pool: SqlPool, now: () => number = Date.now) {
  return async (limit = 100): Promise<{ requestId: number; processed: number; complete: boolean } | null> => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new RangeError('Invalid replay page size.');
    return runSqlTransaction(pool, async sql => {
      const selected = await sql.query<RequestRow>(`SELECT request_id,kind,normalized_alias,valid_from_ms,
        valid_until_ms,phase,cursor_time_ms,cursor_source_id,cursor_observation_id,cursor_message_id
        FROM fleet_identity.replay_requests WHERE phase <> 'DONE' ORDER BY request_id
        FOR UPDATE SKIP LOCKED LIMIT 1`);
      const request = selected.rows[0];
      if (!request) return null;
      const from = Number(request.valid_from_ms);
      const until = request.valid_until_ms === null ? null : Number(request.valid_until_ms);
      const cursor = request.cursor_time_ms === null ? null : Number(request.cursor_time_ms);
      if (request.phase === 'POSITIONS') {
        const rows = request.kind === 'ICAO24' ? await sql.query<{ observed_at_ms: string; source_id: string;
          source_observation_id: string }>(`SELECT observed_at_ms,source_id,source_observation_id
          FROM tracking.position_observations WHERE icao24_hint=$1 AND observed_at_ms >= $2
            AND ($3::bigint IS NULL OR observed_at_ms < $3)
            AND ($4::bigint IS NULL OR (observed_at_ms,source_id,source_observation_id) > ($4,$5,$6))
          ORDER BY observed_at_ms,source_id,source_observation_id LIMIT $7`,
          [request.normalized_alias, from, until, cursor, request.cursor_source_id,
            request.cursor_observation_id, limit]) : { rows: [] };
        for (const row of rows.rows) await postgresPositionLinker(pool).reevaluate(row.source_id, row.source_observation_id);
        const last = rows.rows.at(-1);
        if (last) await sql.query(`UPDATE fleet_identity.replay_requests SET cursor_time_ms=$2,
          cursor_source_id=$3,cursor_observation_id=$4 WHERE request_id=$1`,
          [request.request_id, last.observed_at_ms, last.source_id, last.source_observation_id]);
        if (rows.rows.length < limit) await sql.query(`UPDATE fleet_identity.replay_requests SET phase='MESSAGES',
          cursor_time_ms=NULL,cursor_source_id=NULL,cursor_observation_id=NULL WHERE request_id=$1`, [request.request_id]);
        return { requestId: Number(request.request_id), processed: rows.rows.length, complete: false };
      }
      const rows = await sql.query<{ message_id: string; observed_at_ms: string; canonical: {
        aircraftHints: { icao24?: string; registration?: string; callsign?: string } } }>(`
        SELECT message_id,(canonical #>> '{observation,observedAt,at}')::bigint AS observed_at_ms,canonical
        FROM source_ingestion.message_revisions WHERE revision=1
          AND canonical #>> $1::text[] = $2
          AND (canonical #>> '{observation,observedAt,at}')::bigint >= $3
          AND ($4::bigint IS NULL OR (canonical #>> '{observation,observedAt,at}')::bigint < $4)
          AND ($5::bigint IS NULL OR ((canonical #>> '{observation,observedAt,at}')::bigint,message_id) > ($5,$6))
        ORDER BY observed_at_ms,message_id LIMIT $7`,
        [['aircraftHints', request.kind === 'ICAO24' ? 'icao24' : 'registration'],
          request.normalized_alias, from, until, cursor, request.cursor_message_id, limit]);
      const directory = createRegistryCandidateDirectory(postgresIdentityReader(sql));
      const transaction = { run: <T>(work: Parameters<typeof runDecisionWork<T>>[1]) =>
        runDecisionWork(createPostgresDecisionWriteSet(sql), work) };
      const correlate = createCorrelateMessage({ directory, transaction,
        clock: { now: () => { const time = epochMillis(now());
          if (!time.ok) throw new Error('Invalid replay clock.'); return time.value; } },
        eventIds: { next() { const id = eventId('evt_' + randomUUID());
          if (!id.ok) throw new Error('Invalid event ID.'); return id.value; } } });
      for (const row of rows.rows) {
        const id = messageId(row.message_id);
        if (!id.ok) throw new Error('Invalid stored message ID.');
        const hints = row.canonical.aircraftHints;
        const identifiers: StrongIdentifier[] = [];
        if (hints.icao24) { const parsed = icao24(hints.icao24);
          if (!parsed.ok) throw new Error('Invalid stored ICAO24.'); identifiers.push({ kind: 'ICAO24', value: parsed.value }); }
        if (hints.registration) { const parsed = registration(hints.registration);
          if (!parsed.ok) throw new Error('Invalid stored registration.'); identifiers.push({ kind: 'REGISTRATION', value: parsed.value }); }
        const observedAt = epochMillis(Number(row.observed_at_ms));
        if (!observedAt.ok) throw new Error('Invalid stored observation time.');
        const previous = await createPostgresDecisionReader(sql).readCurrent(id.value);
        const snapshot = await directory.find({ messageId: id.value, effectiveAt: observedAt.value,
          identifiers, callsign: hints.callsign ?? null });
        if (snapshot.completeness !== 'COMPLETE') throw new Error('CANDIDATE_SET_INCOMPLETE');
        if (previous?.directoryRevision === snapshot.revision) continue;
        const result = await correlate({ messageId: id.value, effectiveAt: observedAt.value,
          identifiers, callsign: hints.callsign ?? null }, previous?.revision ?? null);
        if (!result.ok) throw new Error(result.error.code);
      }
      const last = rows.rows.at(-1);
      if (last) await sql.query(`UPDATE fleet_identity.replay_requests SET cursor_time_ms=$2,
        cursor_message_id=$3 WHERE request_id=$1`, [request.request_id, last.observed_at_ms, last.message_id]);
      if (rows.rows.length < limit) await sql.query(`UPDATE fleet_identity.replay_requests SET phase='DONE',
        completed_at=clock_timestamp() WHERE request_id=$1`, [request.request_id]);
      return { requestId: Number(request.request_id), processed: rows.rows.length,
        complete: rows.rows.length < limit };
    });
  };
}
