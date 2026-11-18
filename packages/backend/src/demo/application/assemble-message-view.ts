import type { MessageView } from '../public/types.ts';
import type { StoredMessage } from './stored-message.ts';
export function assembleMessageView(stored: StoredMessage): MessageView {
  return { messageId: stored.canonical.messageId, observedAt: stored.canonical.observedAtIso,
    bearer: stored.canonical.bearer, text: stored.canonical.text,
    correlation: { outcome: stored.decision.status,
      aircraftId: stored.decision.status === 'MATCHED' ? stored.decision.aircraftId : null } };
}
