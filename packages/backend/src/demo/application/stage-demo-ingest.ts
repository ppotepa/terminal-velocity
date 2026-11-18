import { revision } from '../../contracts/identity/index.ts';
import type { EpochMillis } from '../../kernel/time/epoch-millis.ts';
import { decideAircraftMatch, type CandidateDirectory } from '../../modules/aircraft-correlation/public/index.ts';
import { updateAvailability, type FreshnessPolicy } from '../../modules/message-availability/public/index.ts';
import { MAX_DEMO_MESSAGES } from '../domain/limits.ts';
import { sameCanonicalMessage } from '../domain/same-canonical-message.ts';
import type { ApiResult, IngestReceipt } from '../public/types.ts';
import type { DemoState } from './demo-state.ts';
import type { ParsedMessage } from './parsed-message.ts';
import { apiError } from './api-error.ts';
import { assembleMessageView } from './assemble-message-view.ts';
export interface StagedIngest { readonly state: DemoState; readonly receipt: IngestReceipt; }
/** Validation and staging only. The caller owns the one visible commit point. */
export async function stageDemoIngest(state: DemoState, input: ParsedMessage, now: EpochMillis,
  directory: CandidateDirectory, policy: FreshnessPolicy): Promise<ApiResult<StagedIngest>> {
  const canonical = input.canonical;
  if (canonical.observedAt > now) return apiError('VALIDATION_ERROR', 'observedAt cannot be in the future.');
  const previous = state.messages.get(canonical.messageId);
  if (previous) return sameCanonicalMessage(previous.canonical, canonical)
    ? { ok: true, value: { state, receipt: { created: false, message: assembleMessageView(previous) } } }
    : apiError('MESSAGE_CONFLICT', 'This messageId already identifies different canonical content.');
  if (state.messages.size >= MAX_DEMO_MESSAGES)
    return apiError('CAPACITY_EXCEEDED', `The demo can store at most ${MAX_DEMO_MESSAGES} messages.`);
  const correlationInput = { messageId: canonical.messageId, effectiveAt: canonical.observedAt,
    identifiers: input.identifiers, callsign: canonical.callsign };
  const candidates = await directory.find(correlationInput);
  if (candidates.completeness !== 'COMPLETE')
    return apiError('CANDIDATE_SET_INCOMPLETE', 'The candidate directory returned an incomplete result.');
  const decision = decideAircraftMatch(correlationInput, candidates.candidates);
  let availability = state.availability;
  if (decision.status === 'MATCHED') {
    // Each immutable demo message is accepted once: its first published contribution has revision 1.
    const initialRevision = revision(1);
    if (!initialRevision.ok) return apiError('INTERNAL_ERROR', 'Invalid demo contribution revision.');
    const projected = updateAvailability(availability, { type: 'ASSIGNED', revision: initialRevision.value,
      contribution: { messageId: canonical.messageId, aircraftId: decision.aircraftId,
        observedAt: canonical.observedAt, bearer: canonical.bearer, publicEligible: true } }, now, policy);
    if (!projected.ok) return apiError('INTERNAL_ERROR', 'The availability projection could not be staged.');
    availability = projected.value;
  }
  const stored = Object.freeze({ canonical, decision });
  const messages = new Map(state.messages); messages.set(canonical.messageId, stored);
  return { ok: true, value: { state: { messages, availability },
    receipt: { created: true, message: assembleMessageView(stored) } } };
}
