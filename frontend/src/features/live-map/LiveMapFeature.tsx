import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
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
type Props = { client?: ApiClient; tick?: number; tracked?: Set<string>; onSelectAircraft?: (aircraft: Aircraft) => void; selectedAircraftId?: string | null; onMapReady?: (map: MapLibreMap | null) => void };
const fallbackStyle: StyleSpecification = {
  version: 8,
  sources: { countries: {type:'geojson', data:new URL('../../../../backend/data/geography/countries.geojson', import.meta.url).href, attribution:'Natural Earth'} },
  layers:[
    {id:'ocean',type:'background',paint:{'background-color':'#bfd9e6'}},
    {id:'land',type:'fill',source:'countries',paint:{'fill-color':'#f5f2e7','fill-outline-color':'#a8b6ae'}}
  ]
};
const styleURL = import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';

export function LiveMapFeature({ client: suppliedClient, onSelectAircraft, selectedAircraftId, onMapReady, tick, tracked }: Props) {
  const client = useMemo(() => suppliedClient ?? createApiClient(), [suppliedClient]);
  const container = useRef<HTMLDivElement>(null); const mapRef = useRef<MapLibreMap | null>(null); const markersRef = useRef(new Map<string, Marker>()); const fallbackUsed = useRef(false);
  const onMapReadyRef = useRef(onMapReady);
  useEffect(() => { onMapReadyRef.current = onMapReady; }, [onMapReady]);
  const [snapshot, setSnapshot] = useState<Snapshot>(); const [loading, setLoading] = useState(true); const [error, setError] = useState<string>(); const [styleFailed, setStyleFailed] = useState(false);
  const [frames, setFrames] = useState(new Set<string>());
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setError(undefined);
    try {
      const result = await client.GET('/map/snapshot', { signal });
      if (result.error) throw normalizeApiFailure(result.error, result.response.status);
      if (result.data && !signal?.aborted) {
        setSnapshot(result.data);
        const flights = [...new Set(result.data.aircraft.flatMap(a => a.flightId ? [a.flightId] : []))];
        const found = new Set<string>();
        for (let i = 0; i < flights.length; i += 6) {
          await Promise.all(flights.slice(i, i + 6).map(async flightId => {
            const {data} = await client.GET('/messages', {signal, params:{query:{flightId, limit:1}}});
            if (data?.items.length) found.add(flightId);
          }));
        }
        if (!signal?.aborted) setFrames(found);
      }
    } catch (failure) { if (!(failure instanceof DOMException && failure.name === 'AbortError')) setError(normalizeApiFailure(failure).message); }
    finally { setLoading(false); }
  }, [client]);
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); const timer = window.setInterval(() => void refresh(), 20_000); return () => { controller.abort(); window.clearInterval(timer); }; }, [refresh, tick]);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const map = new MapLibreMap({ container: container.current, style: styleURL, center: [0, 20], zoom: 1.4, minZoom: 0, maxZoom: 15, dragRotate: false, pitchWithRotate: false });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.on('error', () => {
      if (!fallbackUsed.current) {
        fallbackUsed.current = true; setStyleFailed(true); map.setStyle(fallbackStyle);
      }
    });
    mapRef.current = map;
    onMapReadyRef.current?.(map);
    return () => { onMapReadyRef.current?.(null); markersRef.current.forEach((marker) => marker.remove()); markersRef.current.clear(); map.remove(); mapRef.current = null; };
  }, []);

  const positioned = useMemo(() => snapshot?.aircraft.filter((item) => item.position) ?? [], [snapshot]);
  const unpositioned = useMemo(() => snapshot?.aircraft.filter((item) => !item.position) ?? [], [snapshot]);
  useEffect(() => {
    const map = mapRef.current; if (!map || !snapshot) return;
    const visible = new Set(positioned.map(a => a.aircraftId));
    for (const [id, marker] of markersRef.current) if (!visible.has(id)) {
      marker.remove();
      markersRef.current.delete(id);
    }
    for (const aircraft of positioned) {
      if (!aircraft.position) continue;
      const existing = markersRef.current.get(aircraft.aircraftId);
      const button = (existing?.getElement() ?? document.createElement('button')) as HTMLButtonElement; button.type = 'button'; button.classList.add('aircraft-marker'); button.classList.toggle('aircraft-marker-selected', aircraft.aircraftId === selectedAircraftId); button.classList.remove('has-frames');
      button.textContent = '✈';
      if (aircraft.flightId && frames.has(aircraft.flightId)) button.classList.add('has-frames');
      button.setAttribute('aria-label', `Select ${aircraft.callsign?.value ?? aircraft.aircraftId}; observed by ${aircraft.position.source} at ${new Date(aircraft.position.observedAt).toLocaleString()}`);
      button.onclick = () => onSelectAircraft?.(aircraft);
      const marker = (existing ?? new Marker({ element: button, anchor: 'center' })).setLngLat([aircraft.position.longitude, aircraft.position.latitude]);
      if (!existing) { marker.addTo(map); markersRef.current.set(aircraft.aircraftId, marker); }
    }
  }, [snapshot, positioned, selectedAircraftId, onSelectAircraft, frames]);
  const select = (aircraft: Aircraft) => onSelectAircraft?.(aircraft);
  return <div className="live-map-feature">
    <Panel title="Observed positions" description="Only aircraft returned for active Watch Rules are shown." action={<div className="map-heading-actions">{snapshot && <StatusPill tone={snapshot.sourceFreshness === 'fresh' ? 'positive' : snapshot.sourceFreshness === 'stale' ? 'warning' : 'neutral'}>{snapshot.sourceFreshness}</StatusPill>}<Button size="sm" onClick={() => void refresh()} aria-label="Refresh map">Refresh</Button></div>}>
      {error && <ErrorState title="Map data could not be loaded" message={error} onRetry={() => void refresh()} />}
      {loading && !snapshot && <LoadingState label="Loading observed aircraft" />}
      <div className="map-layout"><div className="map-canvas-wrap"><div ref={container} className="map-canvas" role="region" aria-label="Map of observed aircraft" />{styleFailed && <div className="map-style-notice" role="status">Showing offline country boundaries.</div>}{snapshot && positioned.length === 0 && <div className="map-no-positions" role="status">No current observed positions. Aircraft without coordinates remain in the list.</div>}</div>
      <aside className="aircraft-list" aria-label="Watched aircraft list"><div className="aircraft-list-heading"><strong>Aircraft · green ring = frames</strong><span>{snapshot?.aircraft.length ?? 0}</span></div>{!loading && !snapshot?.aircraft.length && <p className="aircraft-list-empty">No aircraft match an active Watch Rule yet.</p>}{snapshot?.aircraft.map((aircraft) => <AircraftRow key={aircraft.aircraftId} aircraft={aircraft} selected={aircraft.aircraftId === selectedAircraftId} onSelect={() => { if (aircraft.position) mapRef.current?.easeTo({center:[aircraft.position.longitude,aircraft.position.latitude],zoom:6}); select(aircraft); }} tracked={tracked?.has(String(aircraft.callsign?.value))} />)}{unpositioned.length > 0 && <p className="no-position-note">Listed without a marker because no current position was returned.</p>}</aside></div>
      <p className="map-footnote">Snapshot time: {snapshot ? new Date(snapshot.generatedAt).toLocaleString() : 'not available'} · Source times are shown per aircraft.</p>
    </Panel>
  </div>;
}

function AircraftRow({ aircraft, selected, onSelect, tracked }: { tracked?: boolean; aircraft: Aircraft; selected: boolean; onSelect: () => void }) {
  const position = aircraft.position;
  const callsign = typeof aircraft.callsign?.value === 'string' ? aircraft.callsign.value : aircraft.aircraftId;
  return <button type="button" className={`aircraft-row ${selected ? 'aircraft-row-selected' : ''}`} onClick={onSelect}><span className="aircraft-row-top"><strong>{callsign}{tracked ? ' · Tracking' : ''}</strong><StatusPill tone={position ? 'positive' : 'warning'}>{position ? 'Position observed' : 'No position'}</StatusPill></span><span className="aircraft-row-meta">{position ? `${position.latitude.toFixed(3)}, ${position.longitude.toFixed(3)}` : 'Coordinates not available'}</span><span className="aircraft-row-meta">{position ? `${position.source} · ${new Date(position.observedAt).toLocaleTimeString()}` : `Reason: ${aircraft.noPositionReason ?? 'unknown'}`}</span></button>;
}
