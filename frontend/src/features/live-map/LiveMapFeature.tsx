import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type StyleSpecification,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { components } from '../../shared/api/generated';
import { request, label as tr, type Aircraft, type Corridor, type Mode, type Point } from './workspace';
import { StatusPill } from '../../shared/ui/StatusPill';
import './live-map.css';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
type Snapshot = components['schemas']['MapSnapshot'];
type Props = {
  mode: Mode;
  selected: Aircraft | null;
  track?: Point[][];
  corridor?: Corridor;
  filter: boolean;
  onSnapshot: (items: Aircraft[]) => void;
  onSelectAircraft: (aircraft: Aircraft) => void;
  size: string;
};
const fallbackStyle: StyleSpecification = {
  version: 8,
  sources: {
    countries: {
      type: 'geojson',
      data: new URL('../../../../backend/data/geography/countries.geojson', import.meta.url).href,
      attribution: 'Natural Earth',
    },
  },
  layers: [
    { id: 'ocean', type: 'background', paint: { 'background-color': '#bfd9e6' } },
    {
      id: 'land',
      type: 'fill',
      source: 'countries',
      paint: { 'fill-color': '#f5f2e7', 'fill-outline-color': '#a8b6ae' },
    },
  ],
};
const styleURL = import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';

export function LiveMapFeature({
  mode,
  selected,
  track,
  corridor,
  filter,
  onSnapshot,
  onSelectAircraft,
  size,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(new Map<string, Marker>());
  const fallbackUsed = useRef(false);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(() => window.matchMedia('(min-width: 651px)').matches);
  const [search, setSearch] = useState('');
  const [onlyConfirmed, setOnlyConfirmed] = useState(false);
  const [styleFailed, setStyleFailed] = useState(false);
  const refresh = useCallback(
    async (signal: AbortSignal) => {
      try {
        const data = await request<Snapshot>(mode, 'snapshot', { signal });
        if (!signal.aborted) {
          setSnapshot(data);
          onSnapshot(data.aircraft);
          setError('');
        }
      } catch {
        if (!signal.aborted) setError('Feed unavailable');
      }
    },
    [mode, onSnapshot],
  );
  useEffect(() => {
    const ctrl = new AbortController();
    let timer: number;
    async function poll() {
      await refresh(ctrl.signal);
      if (!ctrl.signal.aborted) timer = window.setTimeout(poll, 5000);
    }
    void poll();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const map = new MapLibreMap({
      container: container.current,
      style: styleURL,
      center: [20, 52],
      zoom: 5,
      minZoom: 0,
      maxZoom: 15,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.on('error', () => {
      if (!fallbackUsed.current) {
        fallbackUsed.current = true;
        setStyleFailed(true);
        map.setStyle(fallbackStyle);
      }
    });
    mapRef.current = map;

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const originalCamera = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const positioned = useMemo(
    () =>
      (snapshot?.aircraft ?? []).filter(
        (a) => a.position && (!filter || (a.flightId && corridor?.members[a.flightId])),
      ),
    [snapshot, filter, corridor],
  );
  const confirmedCount = positioned.filter((a) => a.hasFrames).length;
  const listed = useMemo(
    () => positioned
      .filter((a) => {
        const q = search.trim().toLowerCase();
        const name = String(a.callsign?.value ?? '').toLowerCase();
        return (!onlyConfirmed || a.hasFrames) && (!q || name.includes(q) || a.aircraftId.toLowerCase().includes(q));
      })
      .sort((a, b) =>
        Number(Boolean(b.hasFrames)) - Number(Boolean(a.hasFrames)) ||
        String(a.callsign?.value ?? a.aircraftId).localeCompare(String(b.callsign?.value ?? b.aircraftId)),
      ),
    [positioned, search, onlyConfirmed],
  );
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let dirty = true;
    function draw() {
      if (!map || !map.isStyleLoaded()) return;
      dirty = false;
      const features: GeoJSON.Feature[] = (track ?? [])
        .filter((s) => s.length > 1)
        .map((coordinates) => ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates },
        }));
      for (const segment of track ?? [])
        if (segment.length === 1)
          features.push({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: segment[0] },
          });
      if (corridor) {
        const [a, b] = corridor.line,
          sx = 111.195 * Math.cos(((a[1] + b[1]) * Math.PI) / 360);
        const dx = (b[0] - a[0]) * sx,
          dy = (b[1] - a[1]) * 111.195,
          len = Math.hypot(dx, dy);
        const x = ((-dy / len) * corridor.width) / 2 / sx,
          y = ((dx / len) * corridor.width) / 2 / 111.195;
        const ring = [a, b].map((p) => [p[0] + x, p[1] + y]).concat([b, a].map((p) => [p[0] - x, p[1] - y]));
        features.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
        });
      }
      const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
      const src = map.getSource('flight-overlay') as import('maplibre-gl').GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
        return;
      }
      map.addSource('flight-overlay', { type: 'geojson', data });
      map.addLayer({
        id: 'corridor-area',
        type: 'fill',
        source: 'flight-overlay',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#259584', 'fill-opacity': 0.28 },
      });
      map.addLayer({
        id: 'isolated-position',
        type: 'circle',
        source: 'flight-overlay',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 3, 'circle-color': '#bd642a' },
      });
      map.addLayer({
        id: 'observed-path',
        type: 'line',
        source: 'flight-overlay',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#bd642a', 'line-width': 3 },
      });
    }
    draw();
    map.on('idle', onIdle);
    function onIdle() {
      if (dirty || !map?.getSource('flight-overlay')) draw();
    }
    map.on('load', draw);
    return () => {
      map.off('idle', onIdle);
      map.off('load', draw);
    };
  }, [track, corridor]);
  useEffect(() => {
    const map = mapRef.current,
      p = selected?.position;
    if (!map) return;
    if (!p) {
      if (originalCamera.current) map.jumpTo(originalCamera.current);
      originalCamera.current = null;
      return;
    }
    if (!originalCamera.current)
      originalCamera.current = { center: map.getCenter().toArray() as Point, zoom: map.getZoom() };
    function reveal() {
      if (!map || !p) return;
      const panel = document.querySelector('.flight-panel')?.getBoundingClientRect();
      if (!panel) return;
      const point = map.project([p.longitude, p.latitude]),
        mobile = innerWidth <= 650;
      const right = (mobile ? innerWidth : panel.left) - 24,
        bottom = (mobile ? panel.top : innerHeight - 85) - 23;
      const x = Math.max(24, Math.min(right, point.x)),
        y = Math.max(105, Math.min(bottom, point.y));
      if (x !== point.x || y !== point.y) map.panBy([point.x - x, point.y - y], { duration: 0 });
    }
    reveal();
    window.addEventListener('resize', reveal);
    return () => window.removeEventListener('resize', reveal);
  }, [selected?.flightId, selected?.position?.longitude, selected?.position?.latitude, size]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const missing = selected?.position && !snapshot?.aircraft.some((a) => a.flightId === selected.flightId);
    const display =
      missing && (!filter || corridor?.members[selected.flightId!]) ? [...positioned, selected] : positioned;
    const visible = new Set(display.map((a) => a.flightId || a.aircraftId));
    for (const [id, marker] of markersRef.current)
      if (!visible.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    for (const aircraft of display) {
      if (!aircraft.position) continue;
      const id = aircraft.flightId || aircraft.aircraftId;
      const existing = markersRef.current.get(id);
      const button = (existing?.getElement() ?? document.createElement('button')) as HTMLButtonElement;
      button.type = 'button';
      button.classList.add('aircraft-marker');
      button.classList.toggle('aircraft-marker-selected', aircraft.flightId === selected?.flightId);
      button.classList.remove('has-frames');
      button.classList.toggle('last-known', Boolean(missing && aircraft === selected));
      button.textContent = '✈';
      if (aircraft.hasFrames) button.classList.add('has-frames');
      button.title = aircraft.hasFrames ? 'Confirmed frame on this flight' : 'Observed position';
      button.setAttribute(
        'aria-label',
        `Select ${aircraft.callsign?.value ?? aircraft.aircraftId}; observed by ${aircraft.position.source} at ${new Date(aircraft.position.observedAt).toLocaleString()}`,
      );
      button.onclick = () => onSelectAircraft?.(aircraft);
      const marker = (existing ?? new Marker({ element: button, anchor: 'center' })).setLngLat([
        aircraft.position.longitude,
        aircraft.position.latitude,
      ]);
      if (!existing) {
        marker.addTo(map);
        markersRef.current.set(id, marker);
      }
    }
  }, [snapshot, positioned, selected, filter, corridor, onSelectAircraft]);
  return (
    <div className="live-map-feature">
      <div className="map-layout">
        <div className="map-canvas-wrap">
          <div ref={container} className="map-canvas" role="region" aria-label="Map of observed aircraft" />
          {styleFailed && <small className="map-style-notice">Offline country boundaries</small>}
        </div>
        <aside className="aircraft-list" aria-label={tr('Observed aircraft', 'Zaobserwowane samoloty')}>
          <button className="aircraft-list-heading" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            <span>{tr('Aircraft', 'Samoloty')} · {positioned.length}</span>
            <span>{tr('Frames', 'Ramki')}: {confirmedCount} {expanded ? '▴' : '▾'}</span>
          </button>
          <small className="live-credit">
            {mode === 'live' ? (
              <a href="https://www.adsb.lol/docs/open-data/api/">Central Poland · 150 NM · adsb.lol</a>
            ) : (
              'Debug · Central Poland'
            )}
            <br />
            {error ||
              (snapshot
                ? new Date(snapshot.generatedAt).toLocaleTimeString() +
                  ' · ' + (mode === 'debug' ? 'fixture' : snapshot.sourceFreshness)
                : tr('Loading positions…', 'Wczytywanie pozycji…'))}
          </small>
          {expanded && (
            <>
              <div className="aircraft-list-controls">
                <input
                  type="search"
                  aria-label={tr('Find aircraft by callsign or ICAO', 'Szukaj samolotu po callsign lub ICAO')}
                  placeholder={tr('Callsign or ICAO', 'Callsign lub ICAO')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <label>
                  <input type="checkbox" checked={onlyConfirmed} onChange={(e) => setOnlyConfirmed(e.target.checked)} />
                  {tr('Only confirmed frames', 'Tylko potwierdzone ramki')}
                </label>
              </div>
              <small className="frame-hint">
                {tr('Airframes public API · no result does not mean no frames exist. Green ring = confirmed for this flight.',
                    'Publiczne API Airframes · brak wyniku nie dowodzi braku ramek. Zielony pierścień = potwierdzenie dla tego lotu.')}
              </small>
              {listed.map((a) => (
                <AircraftRow
                  key={a.flightId ?? a.aircraftId}
                  aircraft={a}
                  selected={a.flightId === selected?.flightId}
                  onSelect={() => {
                    if (window.innerWidth <= 650) setExpanded(false);
                    onSelectAircraft(a);
                  }}
                />
              ))}
              {!listed.length && <p className="aircraft-list-empty">{tr('No matching aircraft', 'Brak pasujących samolotów')}</p>}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function AircraftRow({
  aircraft,
  selected,
  onSelect,
}: {
  aircraft: Aircraft;
  selected: boolean;
  onSelect: () => void;
}) {
  const p = aircraft.position;
  const callsign = typeof aircraft.callsign?.value === 'string' ? aircraft.callsign.value : aircraft.aircraftId;
  const status = aircraft.hasFrames ? 'confirmed' : (aircraft.frameStatus ?? 'not_checked');
  const statusName = {
    confirmed: tr('Confirmed frame', 'Ramka potwierdzona'),
    unconfirmed: tr('Uncertain frame', 'Ramka niepewna'),
    no_match: tr('None in checked window', 'Brak w sprawdzonym oknie'),
    unavailable: tr('Airframes unavailable', 'Airframes niedostępne'),
    not_checked: tr('Not checked', 'Nie sprawdzono'),
  }[status];
  const tone = status === 'confirmed' ? 'positive' : status === 'unconfirmed' ? 'warning' :
    status === 'unavailable' ? 'danger' : 'neutral';
  return (
    <button type="button" className={`aircraft-row ${selected ? 'aircraft-row-selected' : ''}`} onClick={onSelect}>
      <span className="aircraft-row-top">
        <strong>{callsign}</strong>
        <StatusPill tone={tone}>{statusName}</StatusPill>
      </span>
      <span className="aircraft-row-meta">ICAO · {aircraft.aircraftId}</span>
      <span className="aircraft-row-meta">
        {p
          ? `${p.latitude.toFixed(3)}, ${p.longitude.toFixed(3)} · ${new Date(p.observedAt).toLocaleTimeString()}`
          : tr('No observed position', 'Brak zaobserwowanej pozycji')}
      </span>
      {aircraft.frameCheckedAt && (
        <span className="aircraft-row-meta">
          {tr('Airframes checked', 'Airframes sprawdzono')} · {new Date(aircraft.frameCheckedAt).toLocaleTimeString()}
        </span>
      )}
    </button>
  );
}
