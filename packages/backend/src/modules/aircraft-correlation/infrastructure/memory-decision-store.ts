import type { MessageId } from '../../../contracts/identity/index.ts';
import type { DecisionEvent } from '../application/decision-event.ts';
import type { StoredDecision } from '../application/stored-decision.ts';
import type { DecisionTransaction, DecisionWriteSet } from '../ports/decision-transaction.ts';
/** Test double: klonowanie stanu + lokalna serializacja. NIE adapter PostgreSQL. */
export function createMemoryDecisionStore() {
  let records = new Map<MessageId, StoredDecision>();
  let events: DecisionEvent[] = [];
  let rejectNextAppend = false;
  let queue: Promise<void> = Promise.resolve();
  const transaction: DecisionTransaction = {
    async run<T>(work: (writes: DecisionWriteSet) => Promise<T>): Promise<T> {
      const previous = queue;
      let release: () => void = () => {};
      queue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      let active = true;
      const ensureActive = () => { if (!active) throw new Error('Transaction capability expired'); };
      const stagedRecords = structuredClone(records);
      const stagedEvents = structuredClone(events);
      const writes: DecisionWriteSet = {
        async read(id) { ensureActive(); return structuredClone(stagedRecords.get(id) ?? null); },
        async put(next) { ensureActive(); stagedRecords.set(next.decision.messageId, structuredClone(next)); },
        async appendOutbox(event) {
          ensureActive();
          if (rejectNextAppend) { rejectNextAppend = false; throw new Error('Injected outbox failure'); }
          if (stagedEvents.some(item => item.eventId === event.eventId)) throw new Error('Duplicate event id');
          stagedEvents.push(structuredClone(event));
        },
      };
      try {
        const result = await work(writes);
        records = stagedRecords; events = stagedEvents;
        return result;
      } finally { active = false; release(); }
    },
  };
  return {
    transaction,
    inspect: () => ({ records: structuredClone(records), outbox: structuredClone(events) }),
    failNextOutboxAppend: () => { rejectNextAppend = true; },
  };
}
