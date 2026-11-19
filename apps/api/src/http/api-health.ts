export interface ApiHealth {
  readonly status: 'ok' | 'unavailable';
  readonly mode: 'demo';
  readonly storage: 'memory' | 'postgres';
}
export type ReadApiHealth = () => Promise<ApiHealth>;
