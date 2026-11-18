import type { AvailabilitySnapshot } from '../domain/availability-snapshot.ts';
import type { Coverage } from '../domain/coverage.ts';
import type { FeedHealth } from '../domain/feed-health.ts';
/** Three independent dimensions. A source failure does not change the last message timestamp. */
export function availabilityView(snapshot: AvailabilitySnapshot, coverage: Coverage, feedHealth: FeedHealth) {
  return { snapshot, coverage, feedHealth };
}
