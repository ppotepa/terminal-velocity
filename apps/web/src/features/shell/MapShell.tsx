import { Panel } from '../../shared/ui/Panel.tsx';
import { StateMessage } from '../../shared/ui/StateMessage.tsx';
import type { MapLoadState } from '../../app/use-map-snapshot.ts';

export function MapShell({ result }: { readonly result: MapLoadState }) {
  return <Panel title="Map" eyebrow="Private local view" className="tv-panel--map">
    <div className="tv-map-surface" aria-label="Map area">
      <div className="tv-map-surface__content">
        <h3>Map view coming soon</h3>
        <p>Aircraft positions in this area will appear here. The status below reflects local observations.</p>
      </div>
    </div>
    <div className="tv-map-summary">
      {result.kind === 'loading' ? <StateMessage kind="loading" title="Loading viewport" /> : null}
      {result.kind === 'error' ? <StateMessage kind="error" title="Viewport unavailable">
        {result.message}</StateMessage> : null}
      {result.kind === 'loaded' && result.snapshot.data.length === 0
        ? <StateMessage kind="empty" title="No positions in this viewport" /> : null}
      {result.kind === 'loaded' && result.snapshot.data.length > 0
        ? <span role="status">{result.snapshot.data.length} aircraft position
          {result.snapshot.data.length === 1 ? '' : 's'} in this viewport
          {result.snapshot.nextCursor ? ' · More results available' : ''}</span> : null}
    </div>
  </Panel>;
}
