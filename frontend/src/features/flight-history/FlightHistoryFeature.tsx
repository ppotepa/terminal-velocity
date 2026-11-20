import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { ArrowRight, Clock3, History, Route } from 'lucide-react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { components } from '../../shared/api/generated';
import { createApiClient, normalizeApiFailure, type ApiClient } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ErrorState, InlineNotice, LoadingState } from '../../shared/ui/AsyncState';
import { Panel } from '../../shared/ui/Panel';
import { StatusPill } from '../../shared/ui/StatusPill';
import { ObservedTrackLayer } from '../flight-tracks/ObservedTrackLayer';
import './flight-history.css';

type Flight = components['schemas']['Flight'];
type Track = components['schemas']['Track'];
type AdapterProps = { map: MapLibreMap | null; track: Track | null };
type Props = { aircraftId?: string | null; client?: ApiClient; map?: MapLibreMap | null; trackLayerAdapter?: ComponentType<AdapterProps>; onFlightSelected?: (flightId: string) => void };

export function FlightHistoryFeature({ aircraftId, client: suppliedClient, map = null, trackLayerAdapter: TrackLayer = ObservedTrackLayer, onFlightSelected }: Props) {
  const client = useMemo(() => suppliedClient ?? createApiClient(), [suppliedClient]);
  const [flights, setFlights] = useState<Flight[]>([]); const [nextCursor, setNextCursor] = useState<string | null>(null); const [selectedId, setSelectedId] = useState<string>(); const [track, setTrack] = useState<Track>();
  const selectedIdRef = useRef<string | undefined>(undefined); const trackController = useRef<AbortController | null>(null);
  const [loadingFlights, setLoadingFlights] = useState(false); const [loadingTrack, setLoadingTrack] = useState(false); const [flightError, setFlightError] = useState<string>(); const [trackError, setTrackError] = useState<string>();
  const [fromDay, setFromDay] = useState(''); const [toDay, setToDay] = useState(''); const [scrubIndex, setScrubIndex] = useState(0);

  const loadFlights = useCallback(async (cursor?: string, append = false, signal?: AbortSignal) => {
    if (!aircraftId) { setFlights([]); setNextCursor(null); setSelectedId(undefined); setTrack(undefined); return; }
    setLoadingFlights(true); setFlightError(undefined);
    try {
      const query = { aircraftId, limit: 50, ...(cursor ? { cursor } : {}), ...(fromDay ? { startedAfter: new Date(`${fromDay}T00:00:00Z`).toISOString() } : {}), ...(toDay ? { startedBefore: new Date(`${toDay}T23:59:59.999Z`).toISOString() } : {}) };
      const result = await client.GET('/flights', { params: { query }, signal });
      if (result.error) throw normalizeApiFailure(result.error, result.response.status);
      const items = result.data?.items ?? [];
      setFlights((current) => append ? [...current, ...items.filter((item) => !current.some((existing) => existing.id === item.id))] : items);
      setNextCursor(result.data?.nextCursor ?? null);
      if (!append && selectedIdRef.current && !items.some((item) => item.id === selectedIdRef.current)) { setSelectedId(undefined); setTrack(undefined); }
    } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setFlightError(normalizeApiFailure(error).message); }
    finally { setLoadingFlights(false); }
  }, [aircraftId, client, fromDay, toDay]);
  useEffect(() => { const controller = new AbortController(); void loadFlights(undefined, false, controller.signal); return () => controller.abort(); }, [loadFlights]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => () => trackController.current?.abort(), []);

  const selectFlight = useCallback(async (flight: Flight) => {
    setSelectedId(flight.id); setTrack(undefined); setTrackError(undefined); setScrubIndex(0); onFlightSelected?.(flight.id);
    trackController.current?.abort();
    const controller = new AbortController(); trackController.current = controller; setLoadingTrack(true);
    try {
      const result = await client.GET('/flights/{flightId}/track', { params: { path: { flightId: flight.id } }, signal: controller.signal });
      if (result.error) throw normalizeApiFailure(result.error, result.response.status);
      if (!controller.signal.aborted) setTrack(result.data);
    } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setTrackError(normalizeApiFailure(error).message); }
    finally { if (trackController.current === controller) { trackController.current = null; setLoadingTrack(false); } }
  }, [client, onFlightSelected]);
  const selectedFlight = flights.find((flight) => flight.id === selectedId);
  const positions = useMemo(() => track?.segments.flat() ?? [], [track]);
  const selectedPoint = positions[scrubIndex];
  useEffect(() => { if (selectedPoint && map) map.easeTo({ center: [selectedPoint.longitude, selectedPoint.latitude], duration: 250 }); }, [selectedPoint, map]);

  return <section className="flight-history-feature">
    <TrackLayer map={map} track={track ?? null} />
    <Panel title="Observed flight history" description="Actual position observations are shown in time order; gaps remain gaps." action={aircraftId && <StatusPill tone="info">Aircraft {aircraftId}</StatusPill>}>
      {!aircraftId ? <div className="history-empty"><History size={20} /><p>Select an aircraft to load its observed flights.</p></div> : <>
        <div className="history-filters"><label>From <input aria-label="Flights starting on or after" type="date" value={fromDay} onChange={(event) => setFromDay(event.target.value)} /></label><label>Through <input aria-label="Flights starting on or before" type="date" value={toDay} onChange={(event) => setToDay(event.target.value)} /></label><Button size="sm" onClick={() => void loadFlights()}>Apply dates</Button></div>
        {flightError && <ErrorState title="Flight history unavailable" message={flightError} onRetry={() => void loadFlights()} />}
        {loadingFlights && flights.length === 0 && <LoadingState label="Loading observed flights" />}
        {!loadingFlights && !flightError && flights.length === 0 && <div className="history-empty"><History size={20} /><p>No observed flights match this aircraft and date range.</p></div>}
        <div className="flight-history-layout"><div className="flight-list" role="list" aria-label="Observed flights">{flights.map((flight) => <button key={flight.id} type="button" role="listitem" className={`flight-history-row ${selectedId === flight.id ? 'flight-history-row-selected' : ''}`} onClick={() => void selectFlight(flight)}><span className="flight-history-row-top"><strong>{evidenceText(flight.callsign?.value) ?? flight.id}</strong>{selectedId === flight.id && <StatusPill tone="info">Selected</StatusPill>}</span><span>{formatTime(flight.startedAt?.observedAt)}{flight.endedAt ? ` – ${formatTime(flight.endedAt.observedAt)}` : ' – ongoing'}</span><span className="flight-history-route">{flight.origin?.code ?? 'Origin not observed'} <ArrowRight size={12} /> {flight.destination?.code ?? 'Destination not observed'}</span></button>)}{nextCursor && <Button size="sm" onClick={() => void loadFlights(nextCursor, true)} disabled={loadingFlights}>{loadingFlights ? 'Loading…' : 'Load more'}</Button>}</div>
          <div className="track-summary" aria-live="polite">{!selectedFlight ? <div className="history-empty"><Route size={18} /><p>Select a flight to inspect its actual track.</p></div> : loadingTrack ? <LoadingState label="Loading observed track" /> : trackError ? <ErrorState title="Track unavailable" message={trackError} /> : track ? <><div className="track-summary-heading"><div><strong>{selectedFlight.id}</strong><span>{positions.length} observations · {track.segments.length} segments{track.truncated ? ' · truncated' : ''}</span></div><StatusPill tone={track.segments.length > 1 ? 'warning' : 'positive'}>{track.segments.length > 1 ? `${track.segments.length - 1} gap(s)` : 'continuous segment'}</StatusPill></div>{selectedPoint && <div className="track-scrubber"><label htmlFor="track-time">Time scrubber</label><input id="track-time" type="range" min={0} max={Math.max(positions.length - 1, 0)} value={scrubIndex} onChange={(event) => setScrubIndex(Number(event.target.value))} disabled={positions.length < 2} /><div><span><Clock3 size={12} /> {formatTime(selectedPoint.observedAt)}</span><span>{selectedPoint.latitude.toFixed(4)}, {selectedPoint.longitude.toFixed(4)}</span></div></div>}{positions.length === 0 ? <div className="history-empty"><Route size={18} /><p>No position observations are available for this flight.</p></div> : <ol className="track-observations">{track.segments.map((segment, index) => <li key={`${segment[0]?.observedAt ?? 'segment'}-${index}`}><span className="segment-label">Segment {index + 1}</span><span>{segment.length} position(s)</span>{segment.length > 0 && <span>{formatTime(segment[0].observedAt)} – {formatTime(segment[segment.length - 1].observedAt)}</span>}</li>)}</ol>}<InlineNotice tone="warning">Country crossings are not supplied by this track read model, so this view does not infer visited countries. Boundary evidence can be shown when the API exposes it.</InlineNotice><div className="track-provenance">Sources: {Array.from(new Set(positions.map((position) => position.source))).join(', ') || 'unknown'} · Use the slider to scrub observed positions; gaps remain separate.</div></> : null}</div></div>
      </>}
    </Panel>
  </section>;
}

function evidenceText(value: unknown): string | undefined { return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined; }
function formatTime(value?: string): string { if (!value) return 'Time unknown'; const date = new Date(value); return Number.isNaN(date.valueOf()) ? 'Time unknown' : date.toLocaleString(); }
