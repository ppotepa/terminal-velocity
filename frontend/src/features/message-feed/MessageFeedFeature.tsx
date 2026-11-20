import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, MessageSquareText, RefreshCw } from 'lucide-react';
import type { components } from '../../shared/api/generated';
import { createApiClient, normalizeApiFailure, type ApiClient } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ErrorState, LoadingState } from '../../shared/ui/AsyncState';
import { EmptyState } from '../../shared/ui/EmptyState';
import { Panel } from '../../shared/ui/Panel';
import { StatusPill } from '../../shared/ui/StatusPill';
import { SelectField } from '../../shared/forms/SelectField';
import { TextField } from '../../shared/forms/TextField';
import './message-feed.css';

type Message = components['schemas']['AircraftMessage'];
type Props = { client?: ApiClient; aircraftId?: string | null; flightId?: string | null; onSelectAircraft?: (aircraftId: string) => void; onSelectFlight?: (flightId: string) => void };

export function MessageFeedFeature({ client: suppliedClient, aircraftId, flightId, onSelectAircraft, onSelectFlight }: Props) {
  const client = useMemo(() => suppliedClient ?? createApiClient(), [suppliedClient]);
  const [messages, setMessages] = useState<Message[]>([]); const [nextCursor, setNextCursor] = useState<string | null>(null); const [protocol, setProtocol] = useState(''); const [contentStatus, setContentStatus] = useState('all');
  const [loading, setLoading] = useState(true); const [loadingMore, setLoadingMore] = useState(false); const [error, setError] = useState<string>(); const [expanded, setExpanded] = useState<string>();
  const load = useCallback(async (cursor?: string, append = false, signal?: AbortSignal) => {
    setError(undefined); append ? setLoadingMore(true) : setLoading(true);
    try {
      const result = await client.GET('/messages', { params: { query: { limit: 50, ...(cursor ? { cursor } : {}), ...(aircraftId ? { aircraftId } : {}), ...(flightId ? { flightId } : {}), ...(protocol.trim() ? { protocol: protocol.trim() } : {}) } }, signal });
      if (!result.response.ok) throw new Error(`Message request failed (HTTP ${result.response.status}).`);
      const items = result.data?.items ?? [];
      setMessages((current) => append ? [...current, ...items.filter((item) => !current.some((known) => known.id === item.id))] : items);
      setNextCursor(result.data?.nextCursor ?? null);
    } catch (failure) { if (!(failure instanceof DOMException && failure.name === 'AbortError')) setError(normalizeApiFailure(failure).message); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [aircraftId, client, flightId, protocol]);
  useEffect(() => { const controller = new AbortController(); setExpanded(undefined); void load(undefined, false, controller.signal); return () => controller.abort(); }, [load]);
  const visible = useMemo(() => contentStatus === 'all' ? messages : messages.filter((message) => message.contentStatus === contentStatus), [contentStatus, messages]);
  const statusTone = (status: Message['contentStatus']) => status === 'provider_decoded' ? 'positive' : status === 'encrypted' ? 'warning' : status === 'unavailable' ? 'neutral' : 'info';

  return <section className="message-feed-feature"><Panel title="Observed messages" description="Permitted messages collected under selected Watch Rules." action={<Button size="sm" onClick={() => void load()} aria-label="Refresh messages"><RefreshCw size={14} /> Refresh</Button>}>
    <div className="message-filters"><TextField label="Protocol" name="message-protocol" placeholder="Any protocol" value={protocol} onChange={(event) => setProtocol(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load(); }} /><SelectField label="Content status" name="content-status" value={contentStatus} options={[{value:'all',label:'All content states'},{value:'provider_decoded',label:'Provider decoded'},{value:'raw',label:'Raw text'},{value:'encrypted',label:'Encrypted'},{value:'unavailable',label:'Unavailable'}]} onChange={(event) => setContentStatus(event.target.value)} /><span className="filter-context">{aircraftId ? `Aircraft ${aircraftId}` : flightId ? `Flight ${flightId}` : 'All selected aircraft'}</span></div>
    {error && <ErrorState title="Messages could not be loaded" message={error} onRetry={() => void load()} />}
    {loading && !messages.length && <LoadingState label="Loading observed messages" />}
    {!loading && !error && visible.length === 0 && <EmptyState icon={<MessageSquareText size={19} />} title="No messages observed" description={messages.length ? 'No messages match the selected content state.' : 'Messages appear only when a selected source returns permitted content. A quiet feed does not prove a source is disconnected.'} />}
    <div className="message-list">{visible.map((message) => {
      const isExpanded = expanded === message.id;
      return <article className="message-card" key={message.id}><header className="message-card-heading"><div className="message-title"><strong>{message.protocol || 'Unknown protocol'}</strong><StatusPill tone={statusTone(message.contentStatus)}>{message.contentStatus.replaceAll('_', ' ')}</StatusPill><StatusPill tone={message.association.outcome === 'matched' ? 'positive' : message.association.outcome === 'ambiguous' || message.association.outcome === 'conflicted' ? 'warning' : 'neutral'}>{message.association.outcome}</StatusPill></div><Button variant="quiet" size="sm" aria-expanded={isExpanded} aria-controls={`message-${message.id}`} onClick={() => setExpanded(isExpanded ? undefined : message.id)}>{isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}<span className="sr-only">{isExpanded ? 'Collapse' : 'Expand'} message {message.id}</span></Button></header>
        <div className="message-meta"><span>{message.source}</span><span>Observed: {formatDate(message.observedAt)}</span><span>Collected: {formatDate(message.collectedAt)}</span><span>{message.direction} · {message.bearer}</span></div>
        {safeText(message.originalText) ? <pre className="message-original">{message.originalText}</pre> : <p className="message-unavailable">{message.contentStatus === 'encrypted' ? 'Encrypted content is not readable.' : message.contentStatus === 'unavailable' ? 'Message content was unavailable from the source.' : 'Original text was not provided.'}</p>}
        <footer className="message-card-footer"><span>{message.decoderResults.length} decoder result(s)</span>{message.association.aircraftId && onSelectAircraft && <Button size="sm" onClick={() => onSelectAircraft(message.association.aircraftId!)}>Aircraft {message.association.aircraftId}</Button>}{message.association.flightId && onSelectFlight && <Button size="sm" onClick={() => onSelectFlight(message.association.flightId!)}>Flight {message.association.flightId}</Button>}</footer>
        {isExpanded && <div id={`message-${message.id}`} className="message-details"><h3>Association evidence</h3><p>Outcome: <strong>{message.association.outcome}</strong> · Candidates: {message.association.candidates.length ? message.association.candidates.join(', ') : 'none returned'}</p><h3>Decoder results</h3>{message.decoderResults.length ? message.decoderResults.map((result, index) => <section className="decoder-result" key={`${result.decoderId ?? 'unknown'}-${index}`}><div className="decoder-result-heading"><strong>{result.decoderId ?? 'Unspecified decoder'}</strong><StatusPill tone={result.status === 'decoded' ? 'positive' : result.status === 'partial' ? 'warning' : 'neutral'}>{result.status}</StatusPill></div>{result.reason && <p>{result.reason}</p>}{result.fields.length ? <dl>{result.fields.map((field) => <div key={field.name}><dt>{field.name}</dt><dd>{displayValue(field.value)}{field.unit ? ` ${field.unit}` : ''}</dd></div>)}</dl> : <p>No structured fields returned.</p>}</section>) : <p className="message-unavailable">No decoder output was recorded for this message.</p>}</div>}
      </article>;
    })}</div>
    {loading && messages.length > 0 && <LoadingState label="Refreshing messages" />}{nextCursor && <div className="message-load-more"><Button size="sm" onClick={() => void load(nextCursor, true)} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</Button></div>}
  </Panel></section>;
}
function safeText(value?: string | null): boolean { return typeof value === 'string' && value.length > 0; }
function displayValue(value: unknown): string { if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value); if (value == null) return 'Unknown'; try { return JSON.stringify(value); } catch { return 'Unrecognized value'; } }
function formatDate(value: string | null): string { if (!value) return 'Time unknown'; const date = new Date(value); return Number.isNaN(date.valueOf()) ? 'Time unknown' : date.toLocaleString(); }
