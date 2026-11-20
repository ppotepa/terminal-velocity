export type ReplayWorkKind = 'JOBS' | 'EXPANSIONS' | 'CORRECTIONS';

const WORK_ORDER: readonly ReplayWorkKind[] = ['JOBS', 'EXPANSIONS', 'CORRECTIONS'];

/** Order the three durable queues fairly; unknown persisted states are an error. */
export function replayWorkOrder(start: unknown): readonly ReplayWorkKind[] {
  const offset = WORK_ORDER.findIndex(kind => kind === start);
  if (offset < 0) throw new Error('Unrecognized identity replay scheduler state.');
  return [...WORK_ORDER.slice(offset), ...WORK_ORDER.slice(0, offset)];
}

/** Advance after the actual class consumed, including when an earlier class was empty. */
export function replayWorkSuccessor(current: ReplayWorkKind): ReplayWorkKind {
  const offset = WORK_ORDER.indexOf(current);
  if (offset < 0) throw new Error('Unrecognized identity replay work kind.');
  return WORK_ORDER[(offset + 1) % WORK_ORDER.length]!;
}
