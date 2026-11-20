export interface IdentityReplayRequest {
  readonly requestId: number;
  readonly assertionId: number;
  readonly kind: 'ICAO24' | 'REGISTRATION';
  readonly normalizedAlias: string;
  readonly validFrom: number;
  readonly validUntil: number | null;
}
export interface ReplayRequestReader {
  list(afterId: number, limit: number): Promise<readonly IdentityReplayRequest[]>;
}
