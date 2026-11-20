import type { SqlPool } from '../../../contracts/database/index.ts';
import type { CandidateDirectory } from '../../aircraft-correlation/public/index.ts';
import type { VerifiedSourceScope } from '../application/accept-source-delivery.ts';
import { normalizeSourceObservation, type NormalizationContext } from '../application/normalize-source-observation.ts';
import { permitsRetention, type RetentionPermission } from '../domain/retention-permission.ts';
import type { SourceDeliveryOrigin } from '../ports/source-delivery-store.ts';
import type { ReplayDelivery } from '../ports/source-replay-checkpoint.ts';
import { createPermittedProviderPipeline } from './create-permitted-provider-pipeline.ts';

/** Replay uses the same retained-input, import and private projection path as ingestion.
 * Collection authorization remains the runner's per-fetch/per-receipt responsibility. */
export function createPermittedReplayDelivery(pool: SqlPool, directory: CandidateDirectory | undefined,
  permission: RetentionPermission, scope: VerifiedSourceScope,
  context: (raw: unknown) => NormalizationContext, origin: () => SourceDeliveryOrigin,
  now: () => number = Date.now) {
  const grant = structuredClone(permission);
  const pipeline = createPermittedProviderPipeline(pool, directory, grant, now);
  const delivery: ReplayDelivery<unknown> = {
    observedAt(raw) {
      const parsed = normalizeSourceObservation(raw, context(raw), scope.capabilities);
      if (!parsed.ok) return { ok: false, error: 'MALFORMED_PAYLOAD' };
      const time = parsed.value.observation.observedAt;
      if (!time || time.basis !== 'OBSERVED') return { ok: false, error: 'INCOMPLETE_TIME' };
      return { ok: true, value: time.at };
    },
    async accept(raw) {
      const ctx = context(raw);
      const parsed = normalizeSourceObservation(raw, ctx, scope.capabilities);
      if (!parsed.ok) return { ok: false, error: { code: 'MALFORMED_PAYLOAD' } };
      if (!permitsRetention(grant, parsed.value.observation))
        return { ok: false, error: { code: 'RIGHTS_REVOKED' } };
      const result = await pipeline.accept(raw, ctx, scope, origin());
      return result.ok ? { ok: true, value: result.value.outcome }
        : { ok: false, error: { code: result.error.code === 'UNAVAILABLE' ? 'TRANSIENT_FAILURE' : 'MALFORMED_PAYLOAD' } };
    },
  };
  return { delivery, pipeline };
}

/** Registry-backed replay composition. The caller still supplies a verified retention grant. */
export function createRegistryReplayDelivery(pool: SqlPool, permission: RetentionPermission,
  scope: VerifiedSourceScope, context: (raw: unknown) => NormalizationContext,
  origin: () => SourceDeliveryOrigin, now: () => number = Date.now) {
  return createPermittedReplayDelivery(pool, undefined, permission, scope, context, origin, now);
}
