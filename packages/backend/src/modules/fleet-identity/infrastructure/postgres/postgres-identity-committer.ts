import type { SqlPool } from '../../../../contracts/database/index.ts';
import { validateIdentityAssertion, type IdentityAssertion } from '../../domain/identity-assertion.ts';
import type { IdentityCommitter } from '../../ports/identity-committer.ts';

export function postgresIdentityCommitter(pool: SqlPool): IdentityCommitter {
  return {
    async createAircraft(id) {
      const result = await pool.query('INSERT INTO fleet_identity.aircraft (aircraft_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
      return result.rowCount === 1;
    },
    async append(raw, supersedesId) {
      const checked = validateIdentityAssertion(raw);
      if (!checked.ok) throw new RangeError(`${checked.error.code}: ${checked.error.field}`);
      if (supersedesId !== undefined && (!Number.isSafeInteger(supersedesId) || supersedesId <= 0))
        throw new RangeError('Invalid superseded assertion.');
      const result = await pool.query<{ assertion_id: string; recorded_at: Date; revision: string }>(`
        SELECT assertion_id,recorded_at,revision FROM fleet_identity.append_assertion(
          $1::text,$2::text,$3::text,$4::bigint,$5::bigint,$6::text,$7::text,$8::bigint)`,
      [checked.value.aircraftId, checked.value.identifier.kind, checked.value.identifier.value,
        checked.value.validFrom, checked.value.validUntil, checked.value.sourceId,
        checked.value.issuer, supersedesId ?? null]);
      const row = result.rows[0]!;
      const assertion: IdentityAssertion = { assertionId: Number(row.assertion_id),
        aircraftId: checked.value.aircraftId, identifier: checked.value.identifier,
        validFrom: checked.value.validFrom, validUntil: checked.value.validUntil,
        recordedAt: row.recorded_at.toISOString(), supersededAt: null,
        sourceId: checked.value.sourceId, issuer: checked.value.issuer, revision: Number(row.revision) };
      return assertion;
    },
  };
}
