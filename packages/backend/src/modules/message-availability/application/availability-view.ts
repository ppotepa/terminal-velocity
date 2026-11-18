import type { AvailabilitySnapshot } from '../domain/availability-snapshot.ts';
import type { Coverage } from '../domain/coverage.ts';
import type { FeedHealth } from '../domain/feed-health.ts';
/** Trzy niezależne osie. Awaria źródła nie zmienia daty ostatniej wiadomości. */
export function availabilityView(snapshot: AvailabilitySnapshot, coverage: Coverage, feedHealth: FeedHealth) {
  return { snapshot, coverage, feedHealth };
}
