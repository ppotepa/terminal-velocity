import type { SqlExecutor } from '../../../../contracts/database/index.ts';
import type { AircraftId } from '../../../../contracts/identity/aircraft-id.ts';
import type { StrongIdentifier } from '../../../aircraft-correlation/public/index.ts';
import type { IdentityAssertion } from '../../domain/identity-assertion.ts';
import type { IdentityReader } from '../../ports/identity-reader.ts';

interface AssertionRow {
  [key: string]: unknown;
  assertion_id: string | null; aircraft_id: string | null; kind: 'ICAO24' | 'REGISTRATION' | null;
  normalized_alias: string | null; valid_from_ms: string | null; valid_until_ms: string | null;
  recorded_at: Date | null; superseded_at: Date | null; source_id: string | null; issuer: string | null; revision: string | null;
  registry_revision: string;
}

export function postgresIdentityReader(pool: SqlExecutor): IdentityReader {
  function decode(row: AssertionRow): IdentityAssertion {
    return { assertionId: Number(row.assertion_id), aircraftId: row.aircraft_id as AircraftId,
      identifier: { kind: row.kind, value: row.normalized_alias } as StrongIdentifier,
      validFrom: Number(row.valid_from_ms), validUntil: row.valid_until_ms === null ? null : Number(row.valid_until_ms),
      recordedAt: row.recorded_at!.toISOString(), supersededAt: row.superseded_at?.toISOString() ?? null,
      sourceId: row.source_id!, issuer: row.issuer!, revision: Number(row.revision) };
  }
  return { async find(identifiers: readonly StrongIdentifier[], observedAt: number) {
    if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw new RangeError('Invalid observation time.');
    const keys = identifiers.map(item => `${item.kind}:${item.value}`);
    const result = await pool.query<AssertionRow>(`
      WITH current_assertions AS (
        SELECT a.*, s.recorded_at AS superseded_at
        FROM fleet_identity.assertions a LEFT JOIN fleet_identity.assertions s ON s.supersedes_id=a.assertion_id
        WHERE s.assertion_id IS NULL
      ), owners AS (
        SELECT DISTINCT aircraft_id FROM current_assertions
        WHERE kind || ':' || normalized_alias = ANY($1::text[])
          AND valid_from_ms <= $2 AND (valid_until_ms IS NULL OR $2 < valid_until_ms)
      )
      SELECT a.*, state.revision AS registry_revision FROM fleet_identity.registry_state state
      LEFT JOIN LATERAL (SELECT * FROM current_assertions
        WHERE aircraft_id IN (SELECT aircraft_id FROM owners)
        ORDER BY assertion_id LIMIT 1001) a ON true WHERE state.singleton`, [keys, observedAt]);
    const revision = Number(result.rows[0]?.registry_revision);
    if (!Number.isSafeInteger(revision)) throw new Error('Invalid registry revision.');
    const nonempty = result.rows.filter(row => row.assertion_id !== null);
    const assertions = nonempty.slice(0, 1000).map(decode);
    return { revision, assertions, completeness: nonempty.length > 1000 ? 'PARTIAL' : 'COMPLETE' };
  }, async history(aircraftId) {
    const result = await pool.query<AssertionRow>(`SELECT a.*,s.recorded_at AS superseded_at,
      state.revision AS registry_revision FROM fleet_identity.assertions a
      LEFT JOIN fleet_identity.assertions s ON s.supersedes_id=a.assertion_id
      CROSS JOIN fleet_identity.registry_state state WHERE a.aircraft_id=$1 AND state.singleton
      ORDER BY a.revision`, [aircraftId]);
    return result.rows.map(decode);
  } };
}
