import type { StoredDecision } from '../../modules/aircraft-correlation/public/index.ts';
import type { ContributionWriter } from '../../modules/message-availability/public/index.ts';
import type { MessageFactsReader } from '../ports/message-facts-reader.ts';

/** Fixed synthetic scope: only decision revisions can change a contribution in this stage. */
export async function projectDecision(stored: StoredDecision, facts: MessageFactsReader, writer: ContributionWriter): Promise<void> {
  const canonical = await facts.readFacts(stored.decision.messageId);
  if (!canonical) throw new Error('The decision has no durable message facts.');
  await writer.apply(stored.decision.status === 'MATCHED'
    ? { type: 'ASSIGNED', revision: stored.revision,
      contribution: { messageId: canonical.messageId, aircraftId: stored.decision.aircraftId,
        observedAt: canonical.observedAt, bearer: canonical.bearer, publicEligible: true } }
    : { type: 'RETRACTED', revision: stored.revision, messageId: canonical.messageId });
}
