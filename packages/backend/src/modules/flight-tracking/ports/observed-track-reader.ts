import type { ObservedTrackCursor, ObservedTrackQuery } from '../domain/observed-track-query.ts';
import type { ObservedTrackSegment } from '../domain/observed-track.ts';

export interface ObservedTrackPage {
  readonly aircraftId: ObservedTrackQuery['aircraftId'];
  readonly projectionRevision: number;
  readonly segments: readonly ObservedTrackSegment[];
  readonly observedCount: number;
  readonly hasMore: boolean;
  readonly next: ObservedTrackCursor | null;
}

export interface ObservedTrackReader {
  read(query: ObservedTrackQuery): Promise<ObservedTrackPage>;
}
