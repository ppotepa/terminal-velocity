import type { SqlPool } from '../../../contracts/database/index.ts';
import { backfillCurrentPositionLinks } from '../infrastructure/postgres/backfill-current-position.ts';
import { createCurrentPositionRebuilder, createCurrentPositionWorker } from '../infrastructure/postgres/current-position-projection.ts';
import { postgresCurrentPositionReader } from '../infrastructure/postgres/current-position-reader.ts';
import { postgresObservedTrackReader } from '../infrastructure/postgres/observed-track-reader.ts';

/** Private durable composition. Source priorities are fixed for each run. */
export function createPostgresCurrentPosition(pool: SqlPool,
  sourcePriority: (sourceId: string) => number = () => 0) {
  return {
    read: postgresCurrentPositionReader(pool),
    readTrack: postgresObservedTrackReader(pool),
    processNext: createCurrentPositionWorker(pool, sourcePriority),
    rebuildAircraft: createCurrentPositionRebuilder(pool, sourcePriority),
    backfillLinks: (limit = 500) => backfillCurrentPositionLinks(pool, limit),
  };
}
