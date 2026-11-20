import type { PositionObservation } from '../domain/position-observation.ts';
import type {
  PositionHistoryByIcao24Query, PositionHistoryCursor, PositionHistoryWithinBoundsQuery,
} from '../domain/position-history-query.ts';

export interface PositionHistoryPage {
  readonly observations: readonly PositionObservation[];
  readonly next: PositionHistoryCursor | null;
}

/** Reads bounded append-only history; ICAO24 is an identifier hint, not a resolved aircraft identity. */
export interface PositionHistoryReader {
  byIcao24(query: PositionHistoryByIcao24Query): Promise<PositionHistoryPage>;
  withinBounds(query: PositionHistoryWithinBoundsQuery): Promise<PositionHistoryPage>;
}
