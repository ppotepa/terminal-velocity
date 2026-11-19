import { airframesConnection } from '../infrastructure/airframes/connection.ts';
import type { PageDelivery, ReadWindow } from '../infrastructure/airframes/page-window.ts';
import type { SourceTransport } from '../ports/source-transport.ts';

type PageTarget = { readonly kind: 'SYNTHETIC_PAGE'; readonly read: ReadWindow }
  | { readonly kind: 'ON_DEMAND_PREVIEW'; readonly read: ReadWindow; inspect(delivery: PageDelivery): void };

export function createProviderConnector(strategy: 'api' | 'crawl', icao: string,
  target?: PageTarget): SourceTransport<PageDelivery> {
  if (strategy === 'crawl' && target) {
    const inspect = target.kind === 'ON_DEMAND_PREVIEW' ? target.inspect.bind(target) : undefined;
    return airframesConnection(icao, target.read, undefined, inspect);
  }
  const outcome = strategy === 'api' ? 'API_UNAVAILABLE' : 'RIGHTS_BLOCKED';
  return {
    start: async () => outcome,
    stop: async () => {},
    health: () => ({ state: 'DISCONNECTED', outcome, accepted: 0, lastReceivedAt: null, coverage: 'UNKNOWN' }),
  };
}
