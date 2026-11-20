import { Component, useState, type ReactNode } from 'react';
import { FilterPanel } from '../features/shell/FilterPanel.tsx';
import { MapShell } from '../features/shell/MapShell.tsx';
import { SelectionPanel } from '../features/shell/SelectionPanel.tsx';
import { Panel } from '../shared/ui/Panel.tsx';
import { StateMessage } from '../shared/ui/StateMessage.tsx';
import { useMapSnapshot } from './use-map-snapshot.ts';
import { useUrlState } from './use-url-state.ts';
import { urlForState, type View } from './url-state.ts';

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed
    ? <main className="tv-main"><StateMessage kind="error" title="This view could not be shown">
      Reload the page to try again.</StateMessage></main> : this.props.children; }
}

function Shell() {
  const [state, navigate] = useUrlState();
  const [bbox, setBbox] = useState('14,48,24,56');
  const [zoom, setZoom] = useState(5);
  const result = useMapSnapshot(state, bbox);
  const views: readonly { id: View; label: string }[] = [
    { id: 'map', label: 'Map' }, { id: 'flights', label: 'Flights' }, { id: 'stations', label: 'Stations' },
  ];
  return <div className="tv-app">
    <a className="tv-skip-link" href="#main">Skip to content</a>
    <header className="tv-header">
      <div className="tv-brand"><strong>Terminal Velocity</strong><span>Private local demo</span></div>
      <nav className="tv-nav" aria-label="Main navigation">
        {views.map(view => <a key={view.id} aria-current={state.view === view.id ? 'page' : undefined}
          href={urlForState(new URL(window.location.href), { ...state, view: view.id }).href}
          onClick={event => { event.preventDefault(); navigate({ ...state, view: view.id }); }}>
          {view.label}</a>)}
      </nav>
    </header>
    <main className="tv-main" id="main">
      <div className="tv-page-head"><div><p className="tv-eyebrow">Workspace</p>
        <h1>{state.view === 'map' ? 'Aircraft map' : state.view === 'flights' ? 'Flights' : 'Stations'}</h1></div>
        <p>Local synthetic data only</p></div>
      {state.view === 'map' ? <div className="tv-layout">
        <FilterPanel state={state} onChange={navigate} />
        <MapShell result={result} state={state} onChange={navigate} zoom={zoom}
          onBounds={(nextBbox, nextZoom) => { setBbox(nextBbox); setZoom(nextZoom); }} />
        <SelectionPanel key={state.aircraft} state={state} result={result} onChange={navigate} />
      </div> : <Panel title={state.view === 'flights' ? 'Flights' : 'Stations'}>
        <StateMessage kind="empty" title="This view is not available yet">
          Return to Map to view the local viewport status.</StateMessage>
      </Panel>}
    </main>
    <footer className="tv-footer">Private local demonstration · Position and message status are separate.</footer>
  </div>;
}

export function App() { return <AppErrorBoundary><Shell /></AppErrorBoundary>; }
