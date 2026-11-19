import { acceptSourceDelivery, type VerifiedSourceScope } from '../application/accept-source-delivery.ts';
import type { SourceDeliveryOrigin } from '../ports/source-delivery-store.ts';
import { parseSourceObservation } from '../domain/source-observation.ts';
import type { ReplayDelivery } from '../ports/source-replay-checkpoint.ts';
import type { SourceAcceptanceTransaction } from '../ports/source-acceptance-transaction.ts';

/** Metadata-only acceptance; does not enable retention or the private message pipeline. */
export function createObservationReplayDelivery(scope: VerifiedSourceScope,
  transaction: SourceAcceptanceTransaction, origin: () => SourceDeliveryOrigin): ReplayDelivery<unknown> {
  return {
    observedAt(raw) {
      const parsed = parseSourceObservation(raw);
      if (!parsed.ok) return { ok: false, error: 'MALFORMED_PAYLOAD' };
      const time = parsed.value.observedAt;
      if (!time || time.basis !== 'OBSERVED') return { ok: false, error: 'INCOMPLETE_TIME' };
      return { ok: true, value: time.at };
    },
    async accept(raw) {
      const result = await acceptSourceDelivery(scope, transaction, raw, origin());
      return result.ok ? { ok: true, value: result.value.outcome }
        : { ok: false, error: { code: result.error.code === 'UNAVAILABLE' ? 'TRANSIENT_FAILURE' : 'MALFORMED_PAYLOAD' } };
    },
  };
}
