import type { EpochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { SourceObservation } from './source-observation.ts';
import type { ObservationTimeEvidence } from './time-evidence.ts';

export interface AircraftHints {
  readonly icao24?: string;
  readonly registration?: string;
  readonly callsign?: string;
}

/** Immutable, transient revision input for #11; this does not authorize retention. */
export interface CanonicalSourceObservation {
  readonly schemaVersion: 1;
  readonly observation: SourceObservation;
  readonly provenance: {
    readonly originalSourceId: string;
    readonly deliveryId: string;
    readonly sourceDescription: string;
    readonly decoder: { readonly name: string; readonly version: string };
    readonly sourceObservedAt?: ObservationTimeEvidence;
    readonly receiverReceivedAt?: ObservationTimeEvidence;
    readonly providerPublishedAt?: ObservationTimeEvidence;
    readonly ingestedAt: ObservationTimeEvidence;
    readonly retrievedAt?: EpochMillis;
    readonly feeder?: string;
    readonly bearerLabel?: string;
    readonly applicationProtocolLabel?: string;
    /** Exact supplied spellings keyed by participant; normalized value is in aircraftHints. */
    readonly originalRegistrations: Readonly<Partial<Record<'aircraft' | 'originator' | 'addressee', string>>>;
  };
  readonly bearer?: string;
  readonly applicationProtocol?: string;
  readonly direction?: string;
  readonly aircraftHints: AircraftHints;
  readonly aircraftRole: 'ORIGINATOR' | 'ADDRESSEE' | 'UNKNOWN';
}

export interface NormalizationError {
  readonly code: 'UNKNOWN_SCHEMA' | 'INVALID_INPUT' | 'UNTRUSTED_TIME' | 'UNSUPPORTED_LEVEL'
    | 'CONFLICTING_HINTS' | 'CAPABILITY_MISMATCH';
  readonly field: string;
  readonly schemaVersion: string;
}
