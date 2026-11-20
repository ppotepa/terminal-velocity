import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { components } from '../../shared/api/generated';
import { createApiClient, normalizeApiFailure, type ApiClient } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ErrorState, LoadingState } from '../../shared/ui/AsyncState';
import { Panel } from '../../shared/ui/Panel';
import { StatusPill } from '../../shared/ui/StatusPill';
import './live-map.css';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
type Snapshot = components['schemas']['MapSnapshot'];
type Aircraft = Snapshot['aircraft'][number];
type Props = { client?: ApiClient; onSelectAircraft?: (aircraftId: string) => void; selectedAircraftId?: string | null; onMapReady?: (map: MapLibreMap | null) => void };
const fallbackStyle: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8efec' } }] };
const styleURL = import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';

export function LiveMapFeature({ client = createApiClient(), onSelectAircraft, selectedAircraftId, onMapReady }: Props) {
  const container = useRef<HTMLDivElement>(null); const mapRef = useRef<MapLibreMap | null>(null); const markersRef = useRef<Marker[]>([]); const fallbackUsed = useRef(false);
  const onMapReadyRef = useRef(onMapReady);
  useEffect(() => { onMapReadyRef.current = onMapReady; }, [onMapReady]);
  const [snapshot, setSnapshot] = useState<Snapshot>(); const [loading, setLoading] = useState(true); const [error, setError] = useState<string>(); const [styleFailed, setStyleFailed] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setError(undefined);
    try {
      const result = await client.GET('/map/snapshot', { signal });
      if (result.error) throw normalizeApiFailure(result.error, result.response.status);
      if (result.data) setSnapshot(result.data);
    } catch (failure) { if (!(failure instanceof DOMException && failure.name === 'AbortError')) setError(normalizeApiFailure(failure).message); }
    finally { setLoading(false); }
  }, [client]);
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); const timer = window.setInterval(() => void refresh(), 20_000); return () => { controller.abort(); window.clearInterval(timer); }; }, [refresh]);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const map = new MapLibreMap({ container: container.current, style: styleURL, center: [10, 50], zoom: 3.2, minZoom: 1.5, maxZoom: 15, dragRotate: false, pitchWithRotate: false });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.on('error', () => {
      if (!fallbackUsed.current) {
        fallbackUsed.current = true; setStyleFailed(true); map.setStyle(fallbackStyle);
      }
    });
    mapRef.current = map;
    onMapReadyRef.current?.(map);
    return () => { onMapReadyRef.current?.(null); markersRef.current.forEach((marker) => marker.remove()); markersRef.current = []; map.remove(); mapRef.current = null; };
  }, []);

  const positioned = useMemo(() => snapshot?.aircraft.filter((item) => item.position) ?? [], [snapshot]);
  const unpositioned = useMemo(() => snapshot?.aircraft.filter((item) => !item.position) ?? [], [snapshot]);
  useEffect(() => {
    const map = mapRef.current; if (!map || !snapshot) return;
    markersRef.current.forEach((marker) => marker.remove()); markersRef.current = [];
    for (const aircraft of positioned) {
      if (!aircraft.position) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = `aircraft-marker ${aircraft.aircraftId === selectedAircraftId ? 'aircraft-marker-selected' : ''}`;
      button.setAttribute('aria-label', `Select ${aircraft.callsign?.value ?? aircraft.aircraftId}; observed by ${aircraft.position.source} at ${new Date(aircraft.position.observedAt).toLocaleString()}`);
      button.addEventListener('click', () => onSelectAircraft?.(aircraft.aircraftId));
      const marker = new Marker({ element: button, anchor: 'center' }).setLngLat([aircraft.position.longitude, aircraft.position.latitude]).addTo(map);
      markersRef.current.push(marker);
    }
    if (positioned.length > 1) {
      const bounds = new LngLatBounds();
      for (const aircraft of positioned) if (aircraft.position) bounds.extend([aircraft.position.longitude, aircraft.position.latitude]);
      map.fitBounds(bounds, { padding: 64, maxZoom: 7, duration: 450 });
    } else if (positioned[0]?.position) {
      map.easeTo({ center: [positioned[0].position.longitude, positioned[0].position.latitude], zoom: Math.max(map.getZoom(), 5), duration: 400 });
    }
  }, [snapshot, positioned, selectedAircraftId, onSelectAircraft]);

  const select = (aircraft: Aircraft) => onSelectAircraft?.(aircraft.aircraftId);
  return <div className="live-map-feature">
    <Panel title="Observed positions" description="Only aircraft returned for active Watch Rules are shown." action={<div className="map-heading-actions">{snapshot && <StatusPill tone={snapshot.sourceFreshness === 'fresh' ? 'positive' : snapshot.sourceFreshness === 'stale' ? 'warning' : 'neutral'}>{snapshot.sourceFreshness}</StatusPill>}<Button size="sm" onClick={() => void refresh()} aria-label="Refresh map">Refresh</Button></div>}>
      {error && <ErrorState title="Map data could not be loaded" message={error} onRetry={() => void refresh()} />}
      {loading && !snapshot && <LoadingState label="Loading observed aircraft" />}
      <div className="map-layout"><div className="map-canvas-wrap"><div ref={container} className="map-canvas" role="region" aria-label="Map of observed aircraft" />{styleFailed && <div className="map-style-notice" role="status">Map tiles are unavailable; aircraft positions remain on the neutral map surface.</div>}{snapshot && positioned.length === 0 && <div className="map-no-positions" role="status">No current observed positions. Aircraft without coordinates remain in the list.</div>}</div>
      <aside className="aircraft-list" aria-label="Watched aircraft list"><div className="aircraft-list-heading"><strong>Selected aircraft</strong><span>{snapshot?.aircraft.length ?? 0}</span></div>{!loading && !snapshot?.aircraft.length && <p className="aircraft-list-empty">No aircraft match an active Watch Rule yet.</p>}{snapshot?.aircraft.map((aircraft) => <AircraftRow key={aircraft.aircraftId} aircraft={aircraft} selected={aircraft.aircraftId === selectedAircraftId} onSelect={() => select(aircraft)} />)}{unpositioned.length > 0 && <p className="no-position-note">Listed without a marker because no current position was returned.</p>}</aside></div>
      <p className="map-footnote">Snapshot time: {snapshot ? new Date(snapshot.generatedAt).toLocaleString() : 'not available'} · Source times are shown per aircraft.</p>
    </Panel>
  </div>;
}

function AircraftRow({ aircraft, selected, onSelect }: { aircraft: Aircraft; selected: boolean; onSelect: () => void }) {
  const position = aircraft.position;
  const callsign = typeof aircraft.callsign?.value === 'string' ? aircraft.callsign.value : aircraft.aircraftId;
  return <button type="button" className={`aircraft-row ${selected ? 'aircraft-row-selected' : ''}`} onClick={onSelect}><span className="aircraft-row-top"><strong>{callsign}</strong><StatusPill tone={position ? 'positive' : 'warning'}>{position ? 'Position observed' : 'No position'}</StatusPill></span><span className="aircraft-row-meta">{position ? `${position.latitude.toFixed(3)}, ${position.longitude.toFixed(3)}` : 'Coordinates not available'}</span><span className="aircraft-row-meta">{position ? `${position.source} · ${new Date(position.observedAt).toLocaleTimeString()}` : `Reason: ${aircraft.noPositionReason ?? 'unknown'}`}</span></button>;
}
