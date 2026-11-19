import { acceptSourceDelivery, type AcceptanceResult, type VerifiedSourceScope } from './accept-source-delivery.ts';
import type { SourceAcceptanceTransaction } from '../ports/source-acceptance-transaction.ts';

/** Normalization belongs to the configured parser. The callback resolves after the acceptance transaction. */
export function createSourceDeliveryHandler<Raw>(scope: VerifiedSourceScope, transaction: SourceAcceptanceTransaction,
  parse: (raw: Raw) => { observation: unknown; origin: unknown }) {
  return async (raw: Raw): Promise<AcceptanceResult> => {
    const { observation, origin } = parse(raw);
    return acceptSourceDelivery(scope, transaction, observation, origin);
  };
}
