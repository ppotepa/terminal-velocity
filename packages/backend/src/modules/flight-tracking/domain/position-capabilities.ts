import { err, ok, type Result } from '../../../kernel/result.ts';
import type { PositionObservation } from './position-observation.ts';
import type { PositionMeasurementKind } from './position-measurement.ts';
import type { PositionObservedAtBasis } from './position-time.ts';
import type { PositionSourceId } from './position-identifiers.ts';

/** Configuration reviewed for one source; the adapter cannot expand this declaration. */
export interface PositionSourceCapabilities {
  readonly sourceId: PositionSourceId;
  readonly measurementKinds: readonly PositionMeasurementKind[];
  readonly observedAtBases: readonly PositionObservedAtBasis[];
}

export type PositionCapabilityError = {
  readonly code: 'UNSUPPORTED_POSITION_CAPABILITY';
  readonly field: 'sourceId' | 'measurementKind' | 'observedAtBasis';
};

export function validatePositionCapabilities(
  observation: PositionObservation,
  capabilities: PositionSourceCapabilities,
): Result<PositionObservation, PositionCapabilityError> {
  if (observation.sourceId !== capabilities.sourceId)
    return err({ code: 'UNSUPPORTED_POSITION_CAPABILITY', field: 'sourceId' });
  if (!capabilities.measurementKinds.includes(observation.measurementKind))
    return err({ code: 'UNSUPPORTED_POSITION_CAPABILITY', field: 'measurementKind' });
  if (!capabilities.observedAtBases.includes(observation.observedAtBasis))
    return err({ code: 'UNSUPPORTED_POSITION_CAPABILITY', field: 'observedAtBasis' });
  return ok(observation);
}
