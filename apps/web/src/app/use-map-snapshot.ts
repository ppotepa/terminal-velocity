import { useEffect, useState } from 'react';
import { createApiClient, type ApiClient } from '../shared/api/api-client.ts';
import { decodeMapSnapshot, type MapSnapshot } from '../shared/api/map-snapshot.ts';
import type { UrlState } from './url-state.ts';

export type MapLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly snapshot: MapSnapshot }
  | { readonly kind: 'error'; readonly message: string };

const client: ApiClient = createApiClient();
const fixedBbox = '14,48,24,56';

/** The shell uses one fixed local viewport until the map feature owns camera state. */
export function useMapSnapshot(state: UrlState): MapLoadState {
  const [stored, setStored] = useState<{ key: string; result: MapLoadState } | null>(null);
  const { view, positionStatus, messageStatus, protocol } = state;
  const key = JSON.stringify([view, positionStatus, messageStatus, protocol]);
  useEffect(() => {
    if (view !== 'map') return;
    const abort = new AbortController();
    const query: Record<string, string> = { bbox: fixedBbox, limit: '500' };
    if (positionStatus) query.positionStatus = positionStatus;
    if (messageStatus) query.messageStatus = messageStatus;
    if (protocol) query.protocol = protocol;
    void client.request<unknown>('/api/v1/internal/map/aircraft', query, abort.signal)
      .then(value => decodeMapSnapshot(value))
      .then(snapshot => { if (!abort.signal.aborted) setStored({ key, result: { kind: 'loaded', snapshot } }); })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) setStored({ key, result: { kind: 'error',
          message: error instanceof Error ? error.message : 'The map request failed.' } });
      });
    return () => abort.abort();
  }, [key, view, positionStatus, messageStatus, protocol]);
  return stored?.key === key ? stored.result : { kind: 'loading' };
}
