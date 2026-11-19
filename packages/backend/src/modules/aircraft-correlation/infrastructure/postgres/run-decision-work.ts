import type { DecisionWriteSet } from '../../ports/decision-transaction.ts';

/** Reuse the same callback guarantees inside a standalone or enclosing transaction. */
export async function runDecisionWork<T>(
  writes: DecisionWriteSet, work: (writes: DecisionWriteSet) => Promise<T>,
): Promise<T> {
  let active = true, failed = false, pendingEvents = 0, inFlight = 0;
  async function guard<Value>(operation: () => Promise<Value>): Promise<Value> {
    if (!active) throw new Error('The decision transaction capability has expired.');
    inFlight += 1;
    try { return await operation(); }
    catch (error) { failed = true; throw error; }
    finally { inFlight -= 1; }
  }
  let result: T;
  try {
    result = await work({
      read: id => guard(() => writes.read(id)),
      put: decision => guard(async () => { await writes.put(decision); pendingEvents += 1; }),
      appendOutbox: event => guard(async () => { await writes.appendOutbox(event); pendingEvents -= 1; }),
    });
  } finally { active = false; }
  if (failed || pendingEvents !== 0 || inFlight !== 0)
    throw new Error('The decision transaction has incomplete or failed writes.');
  return result;
}
