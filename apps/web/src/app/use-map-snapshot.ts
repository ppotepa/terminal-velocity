import { useEffect, useState } from 'react';
import { createApiClient } from '../shared/api/api-client.ts';
import { decodeMapSnapshot, type MapSnapshot } from '../shared/api/map-snapshot.ts';
import type { UrlState } from './url-state.ts';

export type MapLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly snapshot: MapSnapshot }
  | { readonly kind: 'error'; readonly message: string };

const client = createApiClient();

export function useMapSnapshot(state: UrlState, bbox: string): MapLoadState {
  const [stored, setStored] = useState<{ key: string; result: MapLoadState } | null>(null);
  const { view, positionStatus, messageStatus, protocol } = state;
  const key = JSON.stringify([bbox, positionStatus, messageStatus, protocol]);
  useEffect(() => {
    if (view !== 'map') return;
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      const query: Record<string, string> = { bbox, limit: '500' };
      if (positionStatus) query.positionStatus = positionStatus;
      if (messageStatus) query.messageStatus = messageStatus;
      if (protocol) query.protocol = protocol;
      void client.request<unknown>('/api/v1/internal/map/aircraft', query, abort.signal)
        .then(decodeMapSnapshot)
        .then(snapshot => { if (!abort.signal.aborted) setStored({ key, result: { kind: 'loaded', snapshot } }); })
        .catch((error: unknown) => {
          if (!abort.signal.aborted) setStored({ key, result: { kind: 'error',
            message: error instanceof Error ? error.message : 'The map request failed.' } });
        });
    }, 180);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [key, view, bbox, positionStatus, messageStatus, protocol]);
  return stored?.key === key ? stored.result : { kind: 'loading' };
}
