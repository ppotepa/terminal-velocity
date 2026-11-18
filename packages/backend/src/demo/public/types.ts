export type ApiErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'MESSAGE_CONFLICT' | 'CAPACITY_EXCEEDED' | 'CANDIDATE_SET_INCOMPLETE' | 'INTERNAL_ERROR';
export type ApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: ApiErrorCode; readonly message: string } };
import type { DemoBearer } from '../domain/bearer.ts';
export type { DemoBearer } from '../domain/bearer.ts';
export interface MessageView {
  readonly messageId: string;
  readonly observedAt: string;
  readonly bearer: DemoBearer;
  readonly text: string;
  readonly correlation: {
    readonly outcome: 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS' | 'CONFLICTED';
    readonly aircraftId: string | null;
  };
}
export interface IngestReceipt {
  readonly created: boolean;
  readonly message: MessageView;
}
export interface AircraftView {
  readonly aircraftId: string;
  readonly icao24: string;
  readonly registration: string;
  readonly callsign: string;
  readonly position: {
    readonly latitude: number;
    readonly longitude: number;
    readonly altitudeFt: number;
    readonly headingDeg: number;
    readonly observedAt: string;
  };
  readonly availability: {
    readonly freshness: 'RECENT' | 'STALE' | 'NONE';
    readonly lastMessageAt: string | null;
    readonly coverage: 'UNKNOWN';
    readonly feedHealth: 'DISCONNECTED';
  };
  readonly mode: 'demo';
}
export interface DemoTracker {
  ingest(input: unknown): Promise<ApiResult<IngestReceipt>>;
  listAircraft(): Promise<ApiResult<readonly AircraftView[]>>;
  getAircraft(id: string): Promise<ApiResult<AircraftView>>;
  getMessages(aircraftId: string): Promise<ApiResult<readonly MessageView[]>>;
  getMessage(id: string): Promise<ApiResult<MessageView>>;
}
export interface DemoTrackerOptions { readonly now?: () => number; }
