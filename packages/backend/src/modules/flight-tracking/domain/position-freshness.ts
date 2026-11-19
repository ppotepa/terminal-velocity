import { err, ok, type Result } from '../../../kernel/result.ts';
import type { PositionObservation } from './position-observation.ts';
import { utcTimestamp } from './position-time.ts';

export type PositionFreshness = 'CURRENT' | 'STALE' | 'UNKNOWN';
export type InvalidPositionFreshnessPolicy = { readonly code: 'INVALID_POSITION_FRESHNESS_POLICY' };
export type PositionFreshnessPolicy = { readonly currentWithinMs: number };

export function positionFreshnessPolicy(input: unknown):
  Result<PositionFreshnessPolicy, InvalidPositionFreshnessPolicy> {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    return err({ code: 'INVALID_POSITION_FRESHNESS_POLICY' });
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, 'currentWithinMs');
    const value: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      ? ok(Object.freeze({ currentWithinMs: value }))
      : err({ code: 'INVALID_POSITION_FRESHNESS_POLICY' });
  } catch {
    return err({ code: 'INVALID_POSITION_FRESHNESS_POLICY' });
  }
}

/** Uses event time and its declared error bound; ingestion time never affects freshness. */
export function classifyPositionFreshness(
  observation: PositionObservation | null,
  now: string,
  policy: PositionFreshnessPolicy,
): PositionFreshness {
  const current = utcTimestamp(now, 'ingestedAt');
  if (!observation || !current.ok || observation.timestampUncertaintyMs === null) return 'UNKNOWN';
  const age = Date.parse(current.value) - Date.parse(observation.observedAt);
  const uncertainty = observation.timestampUncertaintyMs;
  if (age < 0 || age - uncertainty < 0) return 'UNKNOWN';
  if (age + uncertainty < policy.currentWithinMs) return 'CURRENT';
  if (age - uncertainty >= policy.currentWithinMs) return 'STALE';
  return 'UNKNOWN';
}
