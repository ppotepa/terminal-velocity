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

const PAGE_SIZE = 500;
const MAX_ACTIVE_ASSERTIONS = 2000;

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
    const aliasPredicate = identifiers.length ? identifiers.map((_, index) =>
      `(a.kind=$${index * 2 + 1} AND a.normalized_alias=$${index * 2 + 2})`).join(' OR ') : 'false';
    const observedParameter = identifiers.length * 2 + 1;
    const parameters = [...identifiers.flatMap(item => [item.kind, item.value]), observedAt];
    const assertions: IdentityAssertion[] = [];
    let cursor = 0;
    let revision: number | undefined;
    // Read one row beyond the total budget to distinguish a complete set from
    // a truncated one. Never expose a truncated set as a valid decision.
    for (;;) {
      const remaining = MAX_ACTIVE_ASSERTIONS - assertions.length;
      const pageLimit = Math.min(PAGE_SIZE, remaining + 1);
      const result = await pool.query<AssertionRow>(`
      WITH owners AS (
        SELECT DISTINCT a.aircraft_id FROM fleet_identity.assertions a
        WHERE (${aliasPredicate})
          AND a.valid_from_ms <= $${observedParameter}
          AND (a.valid_until_ms IS NULL OR $${observedParameter} < a.valid_until_ms)
          AND NOT EXISTS (SELECT 1 FROM fleet_identity.assertions successor
            WHERE successor.supersedes_id=a.assertion_id)
      )
      SELECT a.*, state.revision AS registry_revision FROM fleet_identity.registry_state state
      LEFT JOIN LATERAL (SELECT assertion.*, successor.recorded_at AS superseded_at
        FROM fleet_identity.assertions assertion
        LEFT JOIN fleet_identity.assertions successor ON successor.supersedes_id=assertion.assertion_id
        WHERE successor.assertion_id IS NULL
          AND assertion.aircraft_id IN (SELECT aircraft_id FROM owners)
          AND assertion.assertion_id > $${observedParameter + 1}
          AND assertion.valid_from_ms <= $${observedParameter}
          AND (assertion.valid_until_ms IS NULL OR $${observedParameter} < assertion.valid_until_ms)
        ORDER BY assertion.assertion_id LIMIT $${observedParameter + 2}) a ON true WHERE state.singleton`,
      [...parameters, cursor, pageLimit]);
      const pageRevision = Number(result.rows[0]?.registry_revision);
      if (!Number.isSafeInteger(pageRevision)) throw new Error('Invalid registry revision.');
      if (revision !== undefined && revision !== pageRevision)
        return { revision: pageRevision, assertions: [], completeness: 'PARTIAL' };
      revision = pageRevision;
      const page = result.rows.filter(row => row.assertion_id !== null);
      if (page.length > remaining)
        return { revision, assertions: [], completeness: 'PARTIAL' };
      assertions.push(...page.map(decode));
      if (page.length < pageLimit) return { revision, assertions, completeness: 'COMPLETE' };
      cursor = Number(page.at(-1)!.assertion_id);
    }
  }, async history(aircraftId, afterAssertionId = 0, limit = 100) {
    if (!Number.isSafeInteger(afterAssertionId) || afterAssertionId < 0)
      throw new RangeError('Invalid history cursor.');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
      throw new RangeError('History page size must be between 1 and 500.');
    const result = await pool.query<AssertionRow>(`SELECT a.*,s.recorded_at AS superseded_at,
      state.revision AS registry_revision FROM fleet_identity.assertions a
      LEFT JOIN fleet_identity.assertions s ON s.supersedes_id=a.assertion_id
      CROSS JOIN fleet_identity.registry_state state WHERE a.aircraft_id=$1 AND state.singleton
        AND a.assertion_id > $2
      ORDER BY a.assertion_id LIMIT $3`, [aircraftId, afterAssertionId, limit]);
    return result.rows.map(decode);
  } };
}
