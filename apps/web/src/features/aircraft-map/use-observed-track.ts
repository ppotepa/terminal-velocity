import { useEffect, useState } from 'react';
import { createApiClient } from '../../shared/api/api-client.ts';
import { decodeTrackPage, type TrackPage } from './observed-track.ts';

export type TrackLoadState = { kind: 'idle' | 'loading' }
  | { kind: 'loaded'; page: TrackPage }
  | { kind: 'error'; message: string };
const client = createApiClient();

export function useObservedTrack(aircraftId: string, observedAt: string | undefined,
  zoom: number): TrackLoadState {
  const [stored, setStored] = useState<{ key: string; state: TrackLoadState } | null>(null);
  const anchor = observedAt ? Date.parse(observedAt) : 0;
  const day = Math.floor(anchor / 86_400_000);
  const roundedZoom = Math.round(zoom);
  const key = `${aircraftId}:${day}:${roundedZoom}`;
  useEffect(() => {
    if (!aircraftId || !observedAt) return;
    const abort = new AbortController();
    const from = Math.max(0, (day - 1) * 86_400_000);
    const to = (day + 1) * 86_400_000;
    void client.request<unknown>(`/api/v1/internal/aircraft/${aircraftId}/observed-track`,
      { from: String(from), to: String(to), zoom: String(roundedZoom) }, abort.signal)
      .then(value => decodeTrackPage(value, aircraftId))
      .then(page => { if (!abort.signal.aborted) setStored({ key, state: { kind: 'loaded', page } }); })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) setStored({ key, state: { kind: 'error',
          message: error instanceof Error ? error.message : 'The track request failed.' } });
      });
    return () => abort.abort();
  }, [key, aircraftId, day, roundedZoom, observedAt]);
  return !aircraftId || !observedAt ? { kind: 'idle' }
    : stored?.key === key ? stored.state : { kind: 'loading' };
}
