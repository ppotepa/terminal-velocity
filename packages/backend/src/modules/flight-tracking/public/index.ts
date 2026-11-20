export {
  parsePositionObservation, POSITION_OBSERVATION_SCHEMA_VERSION,
  type PositionObservation, type PositionIdentifierHints, type PositionIdentityDecision,
  type PositionIdentityEvidence, type PositionParseError,
} from '../domain/position-observation.ts';
export {
  positionSourceId, sourceObservationId, isDurableSourceObservationId,
  type PositionSourceId, type SourceObservationId, type InvalidPositionIdentifier,
} from '../domain/position-identifiers.ts';
export {
  latitudeDegrees, longitudeDegrees,
  type LatitudeDegrees, type LongitudeDegrees, type InvalidCoordinate,
} from '../domain/geo-coordinate.ts';
export {
  POSITION_MEASUREMENT_KINDS, POSITION_TRACK_KINDS,
  type PositionMeasurementKind, type PositionAltitude, type PositionAltitudes,
  type PositionTrackKind, type InvalidPositionMeasurement,
} from '../domain/position-measurement.ts';
export {
  POSITION_TIME_PRECISIONS, POSITION_OBSERVED_AT_BASES,
  type PositionTimePrecision, type PositionObservedAtBasis, type UtcTimestamp,
} from '../domain/position-time.ts';
export {
  positionQuality, type PositionQuality, type InvalidPositionQuality,
} from '../domain/position-quality.ts';
export { type PositionAdapter, type PositionParseContext, acceptPositionObservation, type PositionAdapterContext } from '../ports/position-adapter.ts';
export {
  validatePositionCapabilities,
  type PositionSourceCapabilities, type PositionCapabilityError,
} from '../domain/position-capabilities.ts';
export {
  classifyPositionFreshness, positionFreshnessPolicy,
  type PositionFreshness, type PositionFreshnessPolicy, type InvalidPositionFreshnessPolicy,
} from '../domain/position-freshness.ts';
export {
  POSITION_HISTORY_MAX_PAGE_SIZE, POSITION_HISTORY_MAX_RANGE_MS,
  positionHistoryByIcao24Query, positionHistoryWithinBoundsQuery,
  type InvalidPositionHistoryQuery, type PositionGeoBounds, type PositionHistoryByIcao24Query,
  type PositionHistoryCursor, type PositionHistoryQuery, type PositionHistoryWindow,
  type PositionHistoryWithinBoundsQuery,
} from '../domain/position-history-query.ts';
export {
  type PositionHistoryWriter, type PositionObservationAppendError, type PositionObservationAppendResult,
} from '../ports/position-history-writer.ts';
export { type PositionHistoryPage, type PositionHistoryReader } from '../ports/position-history-reader.ts';
export { comparePositionEvidence, measurementRank, type PositionEvidenceRank } from '../domain/compare-position-evidence.ts';
export { type CurrentPositionView, type CurrentPositionReader } from '../ports/current-position-reader.ts';
export { createPostgresCurrentPosition } from '../composition/postgres-current-position.ts';
export {
  observedTrackQuery, OBSERVED_TRACK_MAX_PAGE_SIZE, OBSERVED_TRACK_MAX_RANGE_MS,
  type ObservedTrackCursor, type ObservedTrackQuery, type InvalidObservedTrackQuery,
} from '../domain/observed-track-query.ts';
export {
  buildObservedTrack, simplifyObservedTrack, DEFAULT_TRACK_GAP_POLICY,
  type ObservedTrackPoint, type ObservedTrackSegment, type TrackBreakReason, type TrackGapPolicy,
} from '../domain/observed-track.ts';
export { type ObservedTrackPage, type ObservedTrackReader } from '../ports/observed-track-reader.ts';
