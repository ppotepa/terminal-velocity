import { nextRevision, type Revision } from '../../../contracts/identity/index.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';
import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { MatchDecision } from '../domain/match-decision.ts';
import type { DecisionTransaction } from '../ports/decision-transaction.ts';
import type { EventIdGenerator } from '../ports/event-id-generator.ts';
import type { StoredDecision } from './stored-decision.ts';
export type CommitError =
  | { readonly code: 'STALE_REVISION'; readonly actual: Revision | null }
  | { readonly code: 'COMMIT_FAILED' };
export async function commitDecision(
  decision: MatchDecision, expectedRevision: Revision | null,
  directoryRevision: string, decidedAt: EpochMillis,
  transaction: DecisionTransaction, eventIds: EventIdGenerator,
): Promise<Result<StoredDecision, CommitError>> {
  try {
    return await transaction.run(async writes => {
      const current = await writes.read(decision.messageId);
      if ((current?.revision ?? null) !== expectedRevision)
        return err({ code: 'STALE_REVISION' as const, actual: current?.revision ?? null });
      const next: StoredDecision = { decision, revision: nextRevision(expectedRevision), decidedAt, directoryRevision };
      await writes.put(next);
      await writes.appendOutbox({ eventId: eventIds.next(), type: 'correlation.aircraft-decision-revised.v1', payload: next });
      return ok(next);
    });
  } catch {
    // The adapter must also roll back the transaction if the outbox write fails.
    return err({ code: 'COMMIT_FAILED' });
  }
}
