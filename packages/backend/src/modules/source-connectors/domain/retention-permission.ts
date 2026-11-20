import type { SourceObservation } from './source-observation.ts';
import type { SourceDeliveryIdentity } from './source-delivery-identity.ts';
import type { SourceId } from './source-id.ts';
import { isOpaqueText } from './input-validation.ts';

/** Trusted operator configuration, never inferred from a payload or provider name.
 * Evidence authorizes retention and private processing, not publication. */
export interface RetentionPermission extends Omit<SourceDeliveryIdentity, 'externalId'> {
  readonly sourceId: SourceId;
  readonly purpose: 'PRIVATE_PROCESSING';
  readonly retentionAllowed: true;
  readonly evidenceReference: string;
}

export function permitsRetention(permission: RetentionPermission | undefined, observation: SourceObservation): boolean {
  const identity = observation.sourceDeliveryId;
  return !!permission && permission.retentionAllowed === true && permission.purpose === 'PRIVATE_PROCESSING'
    && isOpaqueText(permission.evidenceReference, 512) && permission.sourceId === observation.sourceId
    && permission.provider === identity.provider && permission.accountScope === identity.accountScope
    && permission.sourceEpoch === identity.sourceEpoch;
}
