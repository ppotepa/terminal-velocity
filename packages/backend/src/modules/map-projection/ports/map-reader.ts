import type { MapCursor, MapQuery } from '../domain/map-query.ts';

export interface MapAircraft {
  readonly aircraftId: string;
  readonly position: {
    readonly latitude: number;
    readonly longitude: number;
    readonly observedAt: string;
    readonly freshness: 'CURRENT' | 'STALE' | 'UNKNOWN';
    readonly source: string;
    readonly measurementKind: 'ADS_B' | 'MLAT' | 'OTHER' | 'DEMO';
  };
  readonly messages: {
    readonly freshness: 'RECENT' | 'STALE' | 'NONE';
    readonly lastMessageAt: string | null;
    readonly coverage: 'UNKNOWN';
    readonly feedHealth: 'DISCONNECTED';
  };
}
export interface MapPage {
  readonly data: readonly MapAircraft[];
  readonly nextCursor: MapCursor | null;
  readonly asOf: string;
  readonly checkpoint: number;
}
export interface MapReader { read(query: MapQuery): Promise<MapPage> }
