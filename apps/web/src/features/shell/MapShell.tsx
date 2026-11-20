import { Panel } from '../../shared/ui/Panel.tsx';
import { StateMessage } from '../../shared/ui/StateMessage.tsx';
import type { MapLoadState } from '../../app/use-map-snapshot.ts';
import type { UrlState } from '../../app/url-state.ts';
import { MapViewport } from '../aircraft-map/MapViewport.tsx';
import { markerStatus, uniqueAircraft } from '../aircraft-map/markers.ts';
import { useObservedTrack } from '../aircraft-map/use-observed-track.ts';

interface Props {
  readonly result: MapLoadState;
  readonly state: UrlState;
  readonly onChange: (state: UrlState) => void;
  readonly onBounds: (bbox: string, zoom: number) => void;
  readonly zoom: number;
}

export function MapShell({ result, state, onChange, onBounds, zoom }: Props) {
  const aircraft = result.kind === 'loaded' ? uniqueAircraft(result.snapshot.data) : [];
  const selected = aircraft.find(item => item.aircraftId === state.aircraft);
  const track = useObservedTrack(state.aircraft,
    selected?.position.observedAt ?? (result.kind === 'loaded' ? result.snapshot.asOf : undefined), zoom);
  const onSelect = (aircraftId: string) => onChange({ ...state, aircraft: aircraftId });
  return <Panel title="Map" eyebrow="Private local view" className="tv-panel--map">
    <MapViewport aircraft={aircraft} selected={state.aircraft}
      track={track.kind === 'loaded' ? track.page : null} onBounds={onBounds} onSelect={onSelect} />
    <div className="tv-map-summary">
      <p className="tv-status-note">Message status: <span className="tv-legend-dot tv-legend-dot--recent" /> Recent ·
        <span className="tv-legend-dot tv-legend-dot--stale" /> Older ·
        <span className="tv-legend-dot tv-legend-dot--none" /> None. Position freshness and feed health are listed separately.</p>
      {result.kind === 'loading' ? <StateMessage kind="loading" title="Loading viewport" /> : null}
      {result.kind === 'error' ? <StateMessage kind="error" title="Viewport unavailable">
        {result.message}</StateMessage> : null}
      {result.kind === 'loaded' && aircraft.length === 0
        ? <StateMessage kind="empty" title="No positions in this viewport" /> : null}
      {result.kind === 'loaded' && aircraft.length > 0
        ? <span role="status">{aircraft.length} aircraft position
          {aircraft.length === 1 ? '' : 's'} in this viewport
          {result.snapshot.nextCursor ? ' · More results available' : ''}</span> : null}
      {state.aircraft && !selected && result.kind === 'loaded'
        ? <p role="status">Selected {state.aircraft} is outside the current viewport.</p> : null}
      {state.aircraft && track.kind === 'loaded' ? <p role="status">Observed track: {track.page.observedCount} point
        {track.page.observedCount === 1 ? '' : 's'} in {track.page.segments.length} segment
        {track.page.segments.length === 1 ? '' : 's'}.
        {track.page.hasMore ? ' More observations exist beyond this bounded page.' : ''}
        {track.page.segments.some(segment => segment.breakBefore !== null)
          ? ' Gaps are shown as separate lines.' : ''}</p> : null}
      {state.aircraft && track.kind === 'error'
        ? <StateMessage kind="error" title="Observed track unavailable">{track.message}</StateMessage> : null}
      <div className="tv-map-list" aria-label="Aircraft list">
        <h3>Aircraft in viewport</h3>
        {aircraft.map(item => <button key={item.aircraftId} type="button"
          className="tv-map-list__item" aria-pressed={state.aircraft === item.aircraftId}
          onClick={() => onSelect(item.aircraftId)}>
          <strong>{item.aircraftId}</strong><span>{markerStatus(item).label} · position {item.position.freshness.toLowerCase()}</span>
          <span>{item.position.latitude.toFixed(3)}°, {item.position.longitude.toFixed(3)}° · feed disconnected</span>
        </button>)}
      </div>
    </div>
  </Panel>;
}
