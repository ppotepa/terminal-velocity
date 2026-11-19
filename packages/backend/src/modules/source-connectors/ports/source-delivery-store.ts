import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { SourceDeliveryIdentity } from '../domain/source-delivery-identity.ts';
import type { SourceId } from '../domain/source-id.ts';
import type { SourceObservation } from '../domain/source-observation.ts';
import type { MessageDirection, ObservationDataLevel } from '../domain/source-capabilities.ts';
import type { ObservationTimeEvidence } from '../domain/time-evidence.ts';

export interface SourceDeliveryOrigin {
  readonly pageUrl: string;
  readonly parserVersion: string;
  readonly retrievedAt: EpochMillis;
  readonly ingestedAt: EpochMillis;
}

export type DeliveryDisposition =
  | { readonly state: 'ACCEPTED' }
  | { readonly state: 'QUARANTINED'; readonly reason: string };

export interface SourceDeliveryKey {
  readonly sourceId: SourceId;
  readonly identity: SourceDeliveryIdentity;
}

export interface StoredSourceDelivery extends SourceDeliveryKey, SourceDeliveryOrigin {
  readonly deliveryId: string;
  readonly payloadDigest: string;
  readonly dataLevel: ObservationDataLevel;
  readonly schemaVersion: number;
  readonly capabilitiesRevision: number;
  readonly decoderVersion: string | null;
  readonly receivedAt: Pick<ObservationTimeEvidence, 'at' | 'basis' | 'precision' | 'uncertaintyMs'>;
  readonly observedAt: StoredSourceDelivery['receivedAt'] | null;
  readonly retention: 'METADATA_ONLY';
  readonly disposition: DeliveryDisposition;
  readonly providerMessage: { readonly direction: MessageDirection | null; readonly bearer: string | null } | null;
  readonly reception: { readonly receiverId: string; readonly frequencyHz: number | null; readonly signalStrengthDbm: number | null } | null;
}

export interface SourceDeliveryStore {
  appendDelivery(observation: SourceObservation, origin: SourceDeliveryOrigin, disposition: DeliveryDisposition): Promise<string>;
  findDelivery(key: SourceDeliveryKey): Promise<StoredSourceDelivery | null>;
}
