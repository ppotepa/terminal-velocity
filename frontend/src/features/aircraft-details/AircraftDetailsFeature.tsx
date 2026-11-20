import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Clock3, MessageSquareText, Route, X } from 'lucide-react';
import type { components } from '../../shared/api/generated';
import { createApiClient, normalizeApiFailure, type ApiClient } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ErrorState, LoadingState } from '../../shared/ui/AsyncState';
import { Panel } from '../../shared/ui/Panel';
import { StatusPill } from '../../shared/ui/StatusPill';
import './aircraft-details.css';

type Aircraft = components['schemas']['Aircraft'];
type Flight = components['schemas']['Flight'];
type MessagePage = components['schemas']['MessagePage'];
type Freshness = components['schemas']['MapSnapshot']['sourceFreshness'];
type Props = { aircraftId?: string | null; client?: ApiClient; onClose?: () => void; onViewTrack?: (flightId: string) => void; onViewMessages?: (aircraftId: string) => void };

export function AircraftDetailsFeature({ aircraftId, client: suppliedClient, onClose, onViewTrack, onViewMessages }: Props) {
  const client = useMemo(() => suppliedClient ?? createApiClient(), [suppliedClient]);
  const [aircraft, setAircraft] = useState<Aircraft>(); const [flight, setFlight] = useState<Flight>(); const [messages, setMessages] = useState<MessagePage['items']>([]);
  const [freshness, setFreshness] = useState<Freshness>('unknown'); const [loading, setLoading] = useState(false); const [aircraftError, setAircraftError] = useState<string>(); const [messageError, setMessageError] = useState<string>(); const [flightError, setFlightError] = useState<string>();
  useEffect(() => {
    if (!aircraftId) { setAircraft(undefined); setFlight(undefined); setMessages([]); return; }
    const controller = new AbortController(); setLoading(true); setAircraft(undefined); setFlight(undefined); setMessages([]); setAircraftError(undefined); setMessageError(undefined); setFlightError(undefined);
    void (async () => {
      const [identity, snapshot, flights, messagePage] = await Promise.all([
        client.GET('/aircraft/{aircraftId}', { params: { path: { aircraftId } }, signal: controller.signal }),
        client.GET('/map/snapshot', { signal: controller.signal }),
        client.GET('/flights', { params: { query: { aircraftId, limit: 1 } }, signal: controller.signal }),
        client.GET('/messages', { params: { query: { aircraftId, limit: 1 } }, signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      if (identity.error) setAircraftError(normalizeApiFailure(identity.error, identity.response.status).message); else setAircraft(identity.data);
      if (snapshot.error) setFreshness('unknown'); else {
        const current = snapshot.data?.aircraft.find((item) => item.aircraftId === aircraftId);
        setFreshness(current?.position ? snapshot.data?.sourceFreshness ?? 'unknown' : 'unknown');
      }
      if (flights.error) setFlightError(normalizeApiFailure(flights.error, flights.response.status).message); else setFlight(flights.data?.items[0]);
      if (!messagePage.response.ok) setMessageError(`Message history request failed (HTTP ${messagePage.response.status}).`); else setMessages(messagePage.data?.items ?? []);
      setLoading(false);
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) { setAircraftError(normalizeApiFailure(error).message); setLoading(false); }
    });
    return () => controller.abort();
  }, [aircraftId, client]);

  if (!aircraftId) return <Panel title="Aircraft details"><div className="details-empty">Select an aircraft from the map to inspect its observed details.</div></Panel>;
  if (loading && !aircraft) return <Panel title="Aircraft details"><LoadingState label="Loading aircraft details" /></Panel>;
  if (aircraftError) return <Panel title="Aircraft details" action={onClose && <Button variant="quiet" size="sm" onClick={onClose} aria-label="Close aircraft details"><X size={15} /></Button>}><ErrorState title="Aircraft details unavailable" message={aircraftError} /></Panel>;
  if (!aircraft) return <Panel title="Aircraft details"><div className="details-empty">Aircraft record was not returned.</div></Panel>;

  const identifier = (kind: string) => aircraft.identifiers.find((item) => item.kind === kind)?.value;
  const callsign = evidenceText(aircraft.callsign?.value);
  const position = aircraft.currentPosition;
  const message = messages[0];
  return <aside className="aircraft-details-drawer" aria-label="Aircraft details panel">
    <Panel title={callsign ?? identifier('icao24') ?? aircraft.id} description={`Aircraft ID ${aircraft.id}`} action={onClose && <Button variant="quiet" size="sm" onClick={onClose} aria-label="Close aircraft details"><X size={15} /></Button>}>
      <div className="details-identity-grid"><Detail label="ICAO24" value={identifier('icao24')} /><Detail label="Registration" value={identifier('registration')} /><Detail label="Callsign" value={callsign} /></div>
      <section className="details-section"><div className="details-section-heading"><h3>Position</h3><StatusPill tone={position ? freshness === 'fresh' ? 'positive' : freshness === 'stale' ? 'warning' : 'neutral' : 'warning'}>{position ? freshness : 'not observed'}</StatusPill></div>{position ? <><div className="details-coordinate">{position.latitude.toFixed(4)}, {position.longitude.toFixed(4)}</div><div className="details-facts"><Detail label="Observed" value={formatDate(position.observedAt)} /><Detail label="Source" value={position.source} /><Detail label="Altitude" value={evidenceWithUnit(position.altitudeMeters?.value, 'm')} /><Detail label="Speed" value={evidenceWithUnit(position.groundSpeedMps?.value, 'm/s')} /></div></> : <p className="details-muted">No position has been observed for this aircraft. A missing position does not mean the source is disconnected.</p>}</section>
      <section className="details-section"><div className="details-section-heading"><h3>Current observed flight</h3>{flight?.id && <StatusPill tone="info">Observed</StatusPill>}</div>{flight ? <><div className="details-flight-id">{flight.id}</div><div className="details-route"><Airport label="Origin" code={flight.origin?.code} source={flight.origin?.source} /><ArrowRight size={14} /><Airport label="Destination" code={flight.destination?.code} source={flight.destination?.source} /></div><Detail label="Flight callsign" value={evidenceText(flight.callsign?.value)} />{flight.startedAt && <Detail label="Start evidence" value={`${formatDate(flight.startedAt.observedAt)} · ${flight.startedAt.certainty}`} />}{flight.endedAt && <Detail label="End evidence" value={`${formatDate(flight.endedAt.observedAt)} · ${flight.endedAt.certainty}`} />}{onViewTrack && <Button size="sm" onClick={() => onViewTrack(flight.id)}><Route size={13} /> View observed track</Button>}</> : <p className="details-muted">{flightError ? `Flight history unavailable: ${flightError}` : 'No observed flight is available.'}</p>}</section>
      <section className="details-section"><div className="details-section-heading"><h3>Messages</h3><StatusPill tone={messageError ? 'danger' : message ? 'positive' : 'neutral'}>{messageError ? 'unavailable' : message ? 'observed' : 'none observed'}</StatusPill></div>{message ? <><div className="details-message-protocol">{message.protocol} · {message.source}</div><div className="details-message-times"><span><Clock3 size={12} /> Observed: {message.observedAt ? formatDate(message.observedAt) : 'time unknown'}</span><span>Collected: {formatDate(message.collectedAt)}</span></div>{onViewMessages && <Button size="sm" onClick={() => onViewMessages(aircraftId)}><MessageSquareText size={13} /> View messages</Button>}</> : <p className="details-muted">{messageError ? `Message history unavailable: ${messageError}` : 'No messages observed. Position and communication freshness are reported separately.'}</p>}</section>
    </Panel>
  </aside>;
}

function Detail({ label, value }: { label: string; value?: string | null }) { return <div className="detail-field"><span>{label}</span><strong>{value || 'Not observed'}</strong></div>; }
function Airport({ label, code, source }: { label: string; code?: string; source?: string }) { return <div className="airport-evidence"><span>{label}</span><strong>{code || 'Not observed'}</strong>{code && source && <small>{source}</small>}</div>; }
function evidenceText(value: unknown): string | undefined { return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined; }
function evidenceWithUnit(value: unknown, unit: string): string | undefined { const text = evidenceText(value); return text ? `${text} ${unit}` : undefined; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.valueOf()) ? 'Time unknown' : date.toLocaleString(); }
