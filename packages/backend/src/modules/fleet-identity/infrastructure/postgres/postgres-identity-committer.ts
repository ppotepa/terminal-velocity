import type { SqlPool } from '../../../../contracts/database/index.ts';
import { runSqlTransaction } from '../../../database-transactions/public/index.ts';
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
      return runSqlTransaction(pool, async sql => {
        let old: { assertion_id: string; aircraft_id: string; kind: string; normalized_alias: string; valid_from_ms: string;
          valid_until_ms: string | null; source_id: string; issuer: string } | undefined;
        if (supersedesId !== undefined) {
          if (!Number.isSafeInteger(supersedesId) || supersedesId <= 0) throw new RangeError('Invalid superseded assertion.');
          const previous = await sql.query<typeof old & Record<string, unknown>>(`
            SELECT a.assertion_id,a.aircraft_id,a.kind,a.normalized_alias,a.valid_from_ms,a.valid_until_ms,a.source_id,a.issuer
            FROM fleet_identity.assertions a
            WHERE a.assertion_id=$1 AND NOT EXISTS
              (SELECT 1 FROM fleet_identity.assertions successor WHERE successor.supersedes_id=a.assertion_id)`, [supersedesId]);
          old = previous.rows[0];
          if (!old) throw new Error('Superseded assertion is absent or already corrected.');
          if (old.source_id !== checked.value.sourceId || old.issuer !== checked.value.issuer)
            throw new Error('Only the same source and issuer may correct an assertion.');
        }
        const next = await sql.query<{ revision: string }>(
          'UPDATE fleet_identity.registry_state SET revision=revision+1 WHERE singleton RETURNING revision');
        const revision = Number(next.rows[0]?.revision);
        const inserted = await sql.query<{ assertion_id: string; recorded_at: Date }>(`
          INSERT INTO fleet_identity.assertions
            (aircraft_id,kind,normalized_alias,valid_from_ms,valid_until_ms,source_id,issuer,revision,supersedes_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING assertion_id,recorded_at`,
          [checked.value.aircraftId, checked.value.identifier.kind, checked.value.identifier.value,
            checked.value.validFrom, checked.value.validUntil, checked.value.sourceId,
            checked.value.issuer, revision, supersedesId ?? null]);
        const row = inserted.rows[0]!;
        const changed = [old, { assertion_id: row.assertion_id, aircraft_id: checked.value.aircraftId,
          kind: checked.value.identifier.kind,
          normalized_alias: checked.value.identifier.value, valid_from_ms: String(checked.value.validFrom),
          valid_until_ms: checked.value.validUntil === null ? null : String(checked.value.validUntil) }];
        const replayRanges = new Map<string, { kind: string; normalized_alias: string;
          valid_from_ms: string; valid_until_ms: string | null }>();
        const addRange = (range: { kind: string; normalized_alias: string;
          valid_from_ms: string; valid_until_ms: string | null }) => {
          replayRanges.set(JSON.stringify([range.kind, range.normalized_alias,
            range.valid_from_ms, range.valid_until_ms]), range);
        };
        for (const affected of changed) {
          if (!affected) continue;
          addRange(affected);
          // A changed claim can invalidate decisions made from another active alias
          // of either aircraft, even when the observation never mentions this alias.
          const siblings = await sql.query<{ kind: string; normalized_alias: string;
            valid_from_ms: string; valid_until_ms: string | null }>(`
            SELECT a.kind,a.normalized_alias,a.valid_from_ms,a.valid_until_ms
            FROM fleet_identity.assertions a WHERE a.aircraft_id=$1
              AND NOT EXISTS (SELECT 1 FROM fleet_identity.assertions s WHERE s.supersedes_id=a.assertion_id)
              AND a.valid_from_ms < COALESCE($3::bigint, 9223372036854775807)
              AND COALESCE(a.valid_until_ms, 9223372036854775807) > $2`,
          [affected.aircraft_id, affected.valid_from_ms, affected.valid_until_ms]);
          for (const sibling of siblings.rows) addRange(sibling);
        }
        for (const affected of replayRanges.values()) {
          await sql.query(`INSERT INTO fleet_identity.replay_requests
            (assertion_id,kind,normalized_alias,valid_from_ms,valid_until_ms) VALUES ($1,$2,$3,$4,$5)`,
          [row.assertion_id, affected.kind, affected.normalized_alias,
            affected.valid_from_ms, affected.valid_until_ms]);
        }
        const assertion: IdentityAssertion = { assertionId: Number(row.assertion_id),
          aircraftId: checked.value.aircraftId, identifier: checked.value.identifier,
          validFrom: checked.value.validFrom, validUntil: checked.value.validUntil,
          recordedAt: row.recorded_at.toISOString(), supersededAt: null,
          sourceId: checked.value.sourceId, issuer: checked.value.issuer, revision };
        return assertion;
      });
    },
  };
}
