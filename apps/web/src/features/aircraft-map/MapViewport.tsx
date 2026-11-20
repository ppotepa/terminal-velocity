import { useEffect, useRef, useState } from 'react';
import type { MapAircraft } from '../../shared/api/map-snapshot.ts';
import { MapLayerAdapter } from './MapLayerAdapter.ts';
import type { TrackPage } from './observed-track.ts';

interface Props {
  readonly aircraft: readonly MapAircraft[];
  readonly selected: string;
  readonly track: TrackPage | null;
  readonly onBounds: (bbox: string, zoom: number) => void;
  readonly onSelect: (id: string) => void;
}

export function MapViewport({ aircraft, selected, track, onBounds, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const adapter = useRef<MapLayerAdapter | null>(null);
  const callbacks = useRef({ onBounds, onSelect });
  const [error, setError] = useState('');
  useEffect(() => { callbacks.current = { onBounds, onSelect }; }, [onBounds, onSelect]);
  useEffect(() => {
    if (!container.current) return;
    try {
      const instance = new MapLayerAdapter(container.current,
        (bbox, zoom) => callbacks.current.onBounds(bbox, zoom), setError);
      adapter.current = instance;
      return () => { adapter.current = null; instance.destroy(); };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The map could not start.';
      queueMicrotask(() => setError(message));
    }
  }, []);
  useEffect(() => { adapter.current?.setAircraft(aircraft, selected,
    id => callbacks.current.onSelect(id)); }, [aircraft, selected]);
  useEffect(() => { adapter.current?.setTrack(track); }, [track]);
  return <div className="tv-map-frame">
    <div ref={container} className="tv-map-canvas" aria-label="Interactive aircraft map" />
    {error ? <p className="tv-map-overlay" role="alert">{error}</p> : null}
    {!import.meta.env.VITE_MAP_STYLE_URL ? <p className="tv-map-overlay tv-map-overlay--blank">
      No basemap style configured. Showing aircraft on a blank map; use the list below for positions.
    </p> : null}
  </div>;
}
