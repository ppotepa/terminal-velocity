import type { ReplayCheckpoint, SourceHealth } from '../ports/source-replay-checkpoint.ts';

export function initialSourceHealth(now: number, coverageKind: SourceHealth['coverageKind']): SourceHealth {
  return { connectionState: 'DISCONNECTED', fetchOutcome: 'NONE', parseOutcome: 'NONE', receiptOutcome: 'NONE',
    lastConnectionAt: null, lastProviderEventAt: null, ingestLag: null, coverageKind, asOf: now };
}
/** An empty valid sample is healthy; it does not advance the provider timestamp. */
export function sourceHealth(checkpoint: ReplayCheckpoint, asOf: number): SourceHealth {
  return { ...checkpoint.health, asOf, ingestLag: checkpoint.health.lastProviderEventAt === null
    ? null : Math.max(0, asOf - checkpoint.health.lastProviderEventAt) };
}
