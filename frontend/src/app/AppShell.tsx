import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Compass,
  ShieldCheck,
  History,
  MessageSquareText,
  SlidersHorizontal,
  Bell,
  Settings2,
  X,
} from 'lucide-react';
import { createApiClient } from '../shared/api/client';
import { FlightCard } from '../features/live-map/FlightCard';
import {
  request,
  type Aircraft,
  type Flight,
  type Mode,
  type Corridor,
} from '../features/live-map/workspace';
import { WatchRulesFeature } from '../features/watch-rules/WatchRulesFeature';
import { FlightHistoryFeature } from '../features/flight-history/FlightHistoryFeature';
import { MessageFeedFeature } from '../features/message-feed/MessageFeedFeature';
import { DecoderSettingsFeature } from '../features/decoder-settings/DecoderSettingsFeature';
import { AlertsFeature } from '../features/alerts/AlertsFeature';
import { SourceSettingsFeature } from '../features/source-settings/SourceSettingsFeature';
import './map-workspace.css';

const MapView = lazy(() =>
  import('../features/live-map/LiveMapFeature').then((m) => ({ default: m.LiveMapFeature })),
);
const sections = [
  ['Map', Compass],
  ['Watch Rules', ShieldCheck],
  ['History', History],
  ['Messages', MessageSquareText],
  ['Decoders', SlidersHorizontal],
  ['Alerts', Bell],
  ['Sources', Settings2],
] as const;
type Section = (typeof sections)[number][0];
function initialSelection(mode: Mode): Aircraft | null {
  try {
    return JSON.parse(sessionStorage.getItem('map-selection-' + mode) || 'null');
  } catch {
    return null;
  }
}
export default function AppShell() {
  const client = useMemo(() => createApiClient(), []);
  const [mode, setMode] = useState<Mode>(() =>
    localStorage.getItem('map-mode') === 'debug' ? 'debug' : 'live',
  );
  const live = mode === 'live';
  const [section, navigate] = useState<Section>('Map');
  const [aircraft, select] = useState<Aircraft | null>(() => initialSelection(mode));
  const [flight, setFlight] = useState<Flight>();
  const [tick, update] = useState(0);
  const [size, setSize] = useState('half');
  const [corridor, overlay] = useState<Corridor>();
  const [filter, setFilter] = useState(false);
  const [error, setError] = useState('');
  const [touch, setTouch] = useState(0);
  const fid = aircraft?.flightId;
  const choose = useCallback((a: Aircraft) => {
    select(a);
    setFlight(undefined);
    overlay(undefined);
    setFilter(false);
    navigate('Map');
    setSize('half');
    setError('');
    update((n) => n + 1);
  }, []);
  const reconcile = useCallback(
    (items: Aircraft[]) => select((old) => items.find((a) => a.flightId === old?.flightId) ?? old),
    [],
  );
  useEffect(() => {
    sessionStorage.setItem('map-selection-' + mode, JSON.stringify(aircraft));
  }, [aircraft, mode]);
  useEffect(() => {
    if (!fid || section !== 'Map') return;
    const ctrl = new AbortController();
    let timer: number;
    async function poll() {
      try {
        const f = await request<Flight>(mode, 'flights/' + encodeURIComponent(fid!), { signal: ctrl.signal });
        if (!ctrl.signal.aborted) {
          setFlight(f);
          select(f.item);
          setError('');
        }
      } catch {
        if (!ctrl.signal.aborted) setError('Flight details unavailable');
      } finally {
        if (!ctrl.signal.aborted) timer = window.setTimeout(poll, 4000);
      }
    }
    void poll();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [fid, tick, mode, section]);
  const close = () => {
    select(null);
    navigate('Map');
    setFlight(undefined);
    overlay(undefined);
    setFilter(false);
    setError('');
  };
  return (
    <main className="radar">
      <div className="mode-switch" role="group" aria-label="Map mode">
        {(['debug', 'live'] as const).map((m) => (
          <button
            key={m}
            aria-pressed={mode === m}
            onClick={() => {
              if (mode !== m) {
                close();
                setMode(m);
                localStorage.setItem('map-mode', m);
              }
            }}
          >
            {m === 'live' ? 'Live' : 'Debug'}
          </button>
        ))}
      </div>
      <Suspense fallback={<p>Loading map…</p>}>
        <MapView
          key={mode}
          mode={mode}
          selected={aircraft}
          size={size}
          track={flight?.track}
          corridor={corridor}
          filter={filter}
          onSnapshot={reconcile}
          onSelectAircraft={choose}
        />
      </Suspense>
      {(section !== 'Map' || aircraft) && (
        <aside
          className={'radar-panel ' + (section === 'Map' ? 'flight-panel sheet-' + size : '')}
          aria-label="Workspace panel"
        >
          {section === 'Map' && (
            <button
              className="sheet-handle"
              aria-label={'Resize flight card, currently ' + size}
              onTouchStart={(e) => setTouch(e.touches[0].clientY)}
              onTouchEnd={(e) => {
                const dy = e.changedTouches[0].clientY - touch;
                if (Math.abs(dy) > 25) {
                  e.preventDefault();
                  setSize(dy < 0 ? 'full' : 'compact');
                }
              }}
              onClick={() => setSize(size === 'half' ? 'full' : size === 'full' ? 'compact' : 'half')}
            >
              ━
            </button>
          )}
          <header>
            <h1>{section === 'Map' ? String(aircraft?.callsign?.value || aircraft?.aircraftId) : section}</h1>
            <button onClick={close} aria-label="Close panel">
              <X />
            </button>
          </header>
          {error && <p role="alert">{error}</p>}
          {section === 'Map' && aircraft && (
            <FlightCard
              key={mode + fid}
              mode={mode}
              aircraft={aircraft}
              flight={flight}
              reload={() => update((n) => n + 1)}
              select={choose}
              corridor={corridor}
              overlay={overlay}
              filter={filter}
              setFilter={setFilter}
            />
          )}
          {section === 'Watch Rules' && <WatchRulesFeature client={client} />}
          {section === 'History' && (
            <FlightHistoryFeature client={client} aircraftId={aircraft?.aircraftId} />
          )}
          {section === 'Messages' && (
            <MessageFeedFeature
              client={client}
              aircraftId={aircraft?.aircraftId}
              flightId={aircraft?.flightId}
            />
          )}
          {section === 'Decoders' && <DecoderSettingsFeature client={client} />}
          {section === 'Alerts' && <AlertsFeature client={client} />}
          {section === 'Sources' && <SourceSettingsFeature client={client} />}
        </aside>
      )}
      <nav className="radar-nav" aria-label="Workspace">
        {sections
          .filter(([name]) => !live || name === 'Map')
          .map(([name, Icon]) => (
            <button
              key={name}
              aria-current={section === name ? 'page' : undefined}
              onClick={() => (name === 'Map' ? close() : navigate(name))}
            >
              <Icon size={19} />
              {name}
            </button>
          ))}
      </nav>
    </main>
  );
}
