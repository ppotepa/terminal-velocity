import { commitDecision, decideAircraftMatch, type CandidateDirectory, type EventIdGenerator } from '../../modules/aircraft-correlation/public/index.ts';
import { sameCanonicalMessage } from '../domain/same-canonical-message.ts';
import type { IngestTransaction } from '../ports/ingest-transaction.ts';
import type { ApiResult, IngestReceipt } from '../public/types.ts';
import type { ParsedMessage } from './parsed-message.ts';
import { assembleMessageView } from './assemble-message-view.ts';
import { apiError } from './api-error.ts';
import { readClock } from './read-clock.ts';

export function createIngestDurableMessage(transaction: IngestTransaction, directory: CandidateDirectory,
  eventIds: EventIdGenerator, now: () => number) {
  return async (input: ParsedMessage): Promise<ApiResult<IngestReceipt>> => {
    const time = readClock(now); if (!time.ok) return time;
    const canonical = input.canonical;
    if (canonical.observedAt > time.value) return apiError('VALIDATION_ERROR', 'observedAt cannot be in the future.');
    return transaction.run(canonical.messageId, async writes => {
      const previous = await writes.readMessage();
      if (previous) return sameCanonicalMessage(previous.canonical, canonical)
        ? { ok: true, value: { created: false, message: assembleMessageView(previous) } }
        : apiError('MESSAGE_CONFLICT', 'This messageId already identifies different canonical content.');
      const correlationInput = { messageId: canonical.messageId, effectiveAt: canonical.observedAt,
        identifiers: input.identifiers, callsign: canonical.callsign };
      const candidates = await directory.find(correlationInput);
      if (candidates.completeness !== 'COMPLETE')
        return apiError('CANDIDATE_SET_INCOMPLETE', 'The candidate directory returned an incomplete result.');
      const decision = decideAircraftMatch(correlationInput, candidates.candidates);
      await writes.insertMessage(canonical, time.value);
      const committed = await commitDecision(decision, null, candidates.revision, time.value, writes.decisions, eventIds);
      // A failed decision must abort the enclosing message transaction as well.
      if (!committed.ok) throw new Error('The durable message decision could not be committed.');
      return { ok: true, value: { created: true, message: assembleMessageView({ canonical, decision }) } };
    });
  };
}
