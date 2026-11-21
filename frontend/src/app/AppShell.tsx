import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Compass, ShieldCheck, History, MessageSquareText, SlidersHorizontal, Bell, Settings2, X } from 'lucide-react';
import { createApiClient } from '../shared/api/client';
import type { components } from '../shared/api/generated';
import { subscribeRealtime } from '../shared/realtime/client';
import { WatchRulesFeature } from '../features/watch-rules/WatchRulesFeature';
import { AircraftDetailsFeature } from '../features/aircraft-details/AircraftDetailsFeature';
import { FlightHistoryFeature } from '../features/flight-history/FlightHistoryFeature';
import { MessageFeedFeature } from '../features/message-feed/MessageFeedFeature';
import { DecoderSettingsFeature } from '../features/decoder-settings/DecoderSettingsFeature';
import { AlertsFeature } from '../features/alerts/AlertsFeature';
import { SourceSettingsFeature } from '../features/source-settings/SourceSettingsFeature';
import './map-workspace.css';

const MapView = lazy(() => import('../features/live-map/LiveMapFeature').then(m => ({ default: m.LiveMapFeature })));
const sections = [
  ['Map', Compass], ['Watch Rules', ShieldCheck], ['History', History], ['Messages', MessageSquareText],
  ['Decoders', SlidersHorizontal], ['Alerts', Bell], ['Sources', Settings2],
] as const;
type Section = typeof sections[number][0];
type Aircraft = components['schemas']['MapSnapshot']['aircraft'][number];

export default function AppShell() {
  const client = useMemo(() => createApiClient(), []);
  const [section, navigate] = useState<Section>('Map');
  const [aircraft, select] = useState<Aircraft | null>(null);
  const [tick, update] = useState(0);
  const [saving, setSaving] = useState(false);
  const [tracked, setTracked] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const callsign = typeof aircraft?.callsign?.value === 'string' ? aircraft.callsign.value : '';
  const choose = useCallback((item: Aircraft) => { select(item); navigate('Map'); setError(''); }, []);
  const close = () => { select(null); navigate('Map'); };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { if (!timer) timer = setTimeout(() => { timer = undefined; update(n => n + 1); }, 1000); };
    const stop = subscribeRealtime({onEvent: refresh, onStatus: s => { if (s === 'connected') refresh(); }});
    return () => { stop(); clearTimeout(timer); };
  }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    async function load() {
      const names = new Set<string>();
      let cursor: string | undefined;
      do {
        const { data } = await client.GET('/watch-rules', {signal: ctrl.signal, params:{query:{cursor,limit:100}}});
        if (!data) return;
        for (const rule of data.items) if (rule.status === 'active' && rule.groups.length === 1 && rule.groups[0].criteria.length === 1) {
          const c = rule.groups[0].criteria[0];
          if (c.kind === 'callsign') names.add(c.value);
        }
        cursor = data.nextCursor ?? undefined;
      } while (cursor);
      if (!ctrl.signal.aborted) setTracked(names);
    }
    void load().catch(() => {});
    return () => ctrl.abort();
  }, [client, section, tick]);
  async function track() {
    setSaving(true);
    try {
      const {response} = await client.POST('/watch-rules', {body:{
        name: callsign, status:'active', scope:'targeted', groups:[{mode:'all',criteria:[{kind:'callsign',value:callsign}]}],
        collection:{positions:true,messages:true,decoderIds:['acars-basic']}
      }});
      if (!response.ok) throw Error();
      setTracked(old => new Set(old).add(callsign)); setError('');
    } catch { setError('Could not save the tracking rule. Please retry.'); }
    finally { setSaving(false); }
  }
  return <main className="radar">
    <Suspense fallback={<p>Loading map…</p>}><MapView client={client} onSelectAircraft={choose} selectedAircraftId={aircraft?.aircraftId} tracked={tracked} tick={tick}/></Suspense>
    {(section !== 'Map' || aircraft) && <aside className="radar-panel" aria-label="Workspace panel">
      <header><h1>{section === 'Map' ? callsign || aircraft?.aircraftId : section}</h1><button onClick={close} aria-label="Close panel"><X/></button></header>
      {section === 'Map' && aircraft && <>
        <button className="track-action" disabled={!callsign || saving || tracked.has(callsign)} onClick={track}>{tracked.has(callsign) ? 'Tracking' : saving ? 'Saving…' : 'Add to tracking'}</button>
        {error && <p role="alert">{error}</p>}
        <AircraftDetailsFeature client={client} aircraftId={aircraft.aircraftId} onViewTrack={()=>navigate('History')} onViewMessages={()=>navigate('Messages')}/>
        {aircraft.flightId && <MessageFeedFeature key={aircraft.flightId} client={client} flightId={aircraft.flightId}/>}
      </>}
      {section === 'Watch Rules' && <WatchRulesFeature client={client}/>}
      {section === 'History' && <FlightHistoryFeature client={client} aircraftId={aircraft?.aircraftId}/>}
      {section === 'Messages' && <MessageFeedFeature client={client} aircraftId={aircraft?.aircraftId} flightId={aircraft?.flightId}/>}
      {section === 'Decoders' && <DecoderSettingsFeature client={client}/>}
      {section === 'Alerts' && <AlertsFeature client={client}/>}
      {section === 'Sources' && <SourceSettingsFeature client={client}/>}
    </aside>}
    <nav className="radar-nav" aria-label="Workspace">{sections.map(([name,Icon])=><button key={name} aria-current={section===name?'page':undefined} onClick={()=>name==='Map'?close():navigate(name)}><Icon size={19}/>{name}</button>)}</nav>
  </main>;
}
