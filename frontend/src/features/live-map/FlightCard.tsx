import { useEffect, useRef, useState } from 'react';
import {
  request,
  label as tr,
  type Aircraft,
  type Corridor,
  type Entry,
  type Flight,
  type Kind,
  type Mode,
  type Page,
  type Rule,
  type Source,
} from './workspace';

const targets: Record<Kind, string> = {
  flight: tr('This flight', 'Ten lot'),
  aircraft: tr('All flights of this aircraft', 'Kolejne loty tej maszyny'),
  route: tr('Flights on this connection', 'Loty na tym połączeniu'),
  corridor: tr('Flights observed in this corridor', 'Loty w tym korytarzu'),
};
const states: Record<string, string> = {
  ready: tr('Frames received', 'Odebrano ramki'),
  waiting: tr('Waiting for first frame', 'Oczekiwanie na pierwszą ramkę'),
  unavailable: tr('Source unavailable', 'Źródło niedostępne'),
  uncertain: tr('Uncertain assignment', 'Niepewne przypisanie'),
};
const sources: Source[] = ['ADS-B', 'Airframes'];
const clock = (at: string) => new Date(at).toLocaleTimeString();
function newest(entries: Entry[]) {
  return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));
}
function EventRow({ entry: e }: { entry: Entry }) {
  const p = e.content;
  const label = e.source === 'ADS-B' ? tr('Position', 'Pozycja') : p.protocol || tr('Frame', 'Ramka');
  return (
    <details className="stream-entry">
      <summary>
        <small>
          <time>{clock(e.at)}</time> · {e.source} · {label}
        </small>
        <span>
          {e.source === 'ADS-B'
            ? `${p.latitude?.toFixed(3)}°, ${p.longitude?.toFixed(3)}°`
            : p.decoded || tr('Radio frame', 'Ramka radiowa')}
          {!e.confirmed && tr(' · Uncertain assignment', ' · Niepewne przypisanie')}
        </span>
      </summary>
      <p>{e.source === 'ADS-B' ? tr('Observed position', 'Zaobserwowana pozycja') : p.decoded || tr('No decoded text supplied', 'Brak zdekodowanej treści')}</p>
      <pre>{JSON.stringify(p.raw ?? p, null, 2)}</pre>
      {e.source === 'Airframes' && (
        <p>{e.receipts.map((r) => r.station + ' · ' + clock(r.at)).join(' / ') || tr('Receiver unknown', 'Nieznany odbiornik')}</p>
      )}
    </details>
  );
}
function Stream({ mode, path, hidden }: { mode: Mode; path: string; hidden: boolean }) {
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<Entry[]>([]);
  const [pending, setPending] = useState<Entry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const known = useRef(new Set<string>());
  useEffect(() => {
    const ctrl = new AbortController();
    const ids = new Set<string>();
    known.current = ids;
    generation.current++;
    setItems([]);
    setPending([]);
    setNext(null);
    setLoading(false);
    setError('');
    let timer: number;
    const fetchPage = (before = '') =>
      request<Page>(mode, path + '/events?' + new URLSearchParams({ source: filter, before }), {
        signal: ctrl.signal,
      });
    async function poll() {
      try {
        const page = await fetchPage();
        let batch = page.items,
          cursor = page.next;
        while (ids.size && cursor && batch.length && !batch.some((e) => ids.has(e.id))) {
          const older = await fetchPage(cursor);
          batch = batch.concat(older.items);
          cursor = older.next;
        }
        if (ctrl.signal.aborted) return;
        if (!ids.size) setNext(page.next);
        const fresh = batch.filter((e) => !ids.has(e.id));
        for (const e of fresh) ids.add(e.id);
        if (fresh.length) {
          const paused =
            (list.current?.scrollTop ?? 0) > 5 ||
            list.current?.querySelector('details[open]') ||
            list.current?.closest('[hidden]');
          if (paused && ids.size > fresh.length) setPending((p) => [...fresh, ...p]);
          else setItems((p) => newest([...fresh, ...p]));
        }
        const updates = new Map(page.items.map((e) => [e.id, e]));
        const reconcile = (entries: Entry[]) => entries.map((e) => updates.get(e.id) ?? e);
        setItems(reconcile);
        setPending(reconcile);
        setError('');
      } catch {
        if (!ctrl.signal.aborted) setError(tr('Stream unavailable', 'Strumień niedostępny'));
      } finally {
        if (!ctrl.signal.aborted) timer = window.setTimeout(poll, 4000);
      }
    }
    void poll();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
      generation.current++;
    };
  }, [mode, path, filter]);
  async function older() {
    if (!next || loading) return;
    const active = generation.current;
    setLoading(true);
    try {
      const page = await request<Page>(
        mode,
        path + '/events?' + new URLSearchParams({ before: next, source: filter }),
      );
      if (active !== generation.current) return;
      const unseen = page.items.filter((e) => !known.current.has(e.id));
      unseen.forEach((e) => known.current.add(e.id));
      setItems((p) => [...p, ...unseen]);
      setNext(page.next);
    } catch {
      if (active === generation.current) setError(tr('Could not load older events', 'Nie udało się wczytać starszych zdarzeń'));
    } finally {
      if (active === generation.current) setLoading(false);
    }
  }
  return (
    <section className="stream" hidden={hidden}>
      <div className="stream-head">
        <strong>{tr('Event stream', 'Strumień zdarzeń')}</strong>
        <select
          aria-label="Filter stream by source or type"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">{tr('All events', 'Wszystkie zdarzenia')}</option>
          <option value="ADS-B">{tr('ADS-B · Positions', 'ADS-B · Pozycje')}</option>
          <option value="Airframes">{tr('Airframes · Frames', 'Airframes · Ramki')}</option>
        </select>
      </div>
      {pending.length > 0 && (
        <button
          onClick={() => {
            setItems((p) => newest([...pending, ...p]));
            setPending([]);
            if (list.current) list.current.scrollTop = 0;
          }}
        >
          {tr('New events', 'Nowe zdarzenia')} · {pending.length}
        </button>
      )}
      <div className="event-list" ref={list}>
        {error && <p role="alert">{error}</p>}
        {items.map((e) => (
          <EventRow key={e.id} entry={e} />
        ))}
        {!items.length && <p>{tr('No matching events yet.', 'Brak pasujących zdarzeń.')}</p>}
        {next && (
          <button disabled={loading} onClick={older}>
            {tr('Older events', 'Starsze zdarzenia')}
          </button>
        )}
      </div>
    </section>
  );
}

type Props = {
  mode: Mode;
  aircraft: Aircraft;
  flight?: Flight;
  reload: () => void;
  select: (a: Aircraft) => void;
  corridor?: Corridor;
  overlay: (c?: Corridor) => void;
  filter: boolean;
  setFilter: (v: boolean) => void;
};
export function FlightCard({
  mode,
  aircraft: a,
  flight: f,
  reload,
  select,
  corridor,
  overlay,
  filter,
  setFilter,
}: Props) {
  const [view, setView] = useState<'flight' | 'route' | 'rules'>('flight');
  const [kind, setKind] = useState<Kind>('flight');
  const [channels, setChannels] = useState<Source[]>(sources);
  const [variant, setVariant] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [legacy, setLegacy] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('live-aircraft') || '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  });
  const path = 'flights/' + encodeURIComponent(a.flightId!);
  const current = useRef(true);
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
    };
  }, []);
  const corridorId = variant || f?.corridors[0]?.id || '';
  async function save(k: Kind, src: Source[], active: boolean, target?: string) {
    setSaving(true);
    setError('');
    try {
      await request(mode, path + '/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: k, sources: src, active, target }),
      });
      if (current.current) reload();
    } catch {
      if (current.current) setError(tr('Could not save listener. Retry.', 'Nie udało się zapisać nasłuchu. Spróbuj ponownie.'));
    } finally {
      if (current.current) setSaving(false);
    }
  }
  async function migrate(id: string) {
    setSaving(true);
    setError('');
    try {
      await request(mode, 'legacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aircraftId: id }),
      });
      const remaining = legacy.filter((ac) => ac !== id);
      localStorage.setItem('live-aircraft', JSON.stringify(remaining));
      if (current.current) {
        setLegacy(remaining);
        reload();
      }
    } catch {
      if (current.current) setError(tr('Could not import local listener', 'Nie udało się przenieść nasłuchu'));
    } finally {
      if (current.current) setSaving(false);
    }
  }
  const target = {
    flight: a.flightId,
    aircraft: a.aircraftId,
    route: f?.origin + '/' + f?.destination,
    corridor: corridorId,
  }[kind];
  const saved = f?.rules.some(
    (r) =>
      r.kind === kind &&
      r.target === target &&
      r.sources.length === channels.length &&
      channels.every((c) => r.sources.includes(c)),
  );
  const position = a.position;
  const age = position ? Math.max(0, Math.floor((Date.now() - Date.parse(position.observedAt)) / 1000)) : 0;
  function ruleRow(r: Rule) {
    return (
      <p key={r.kind + r.target + r.sources}>
        {targets[r.kind]} · {r.sources.join(' + ')}{' '}
        <button disabled={saving} onClick={() => void save(r.kind, r.sources, false, r.target)}>
          {tr('Disable', 'Wyłącz')}
        </button>
      </p>
    );
  }
  return (
    <>
      <div className="flight-summary">
        <small>
          ICAO · {a.aircraftId}
          {mode === 'live' ? tr(' · Inferred flight', ' · Lot rozpoznany z obserwacji') : ''}
        </small>
        <div className="flight-actions">
          {f?.origin || f?.destination ? (
            <button onClick={() => setView('route')}>
              {f.origin || '?'} → {f.destination || '?'}
            </button>
          ) : (
            <span>{tr('Connection unknown', 'Nieznane połączenie')}</span>
          )}
          <button className="track-action" onClick={() => setView('rules')}>
            {tr('Add listener', 'Dodaj nasłuch')}{f?.rules.length ? ' · ' + f.rules.length : ''}
          </button>
        </div>
        <div className="flight-stats">
          {[
            [tr('Altitude', 'Wysokość'), position?.altitudeMeters?.value, 'm'],
            [tr('Speed', 'Prędkość'), position?.groundSpeedMps?.value, 'm/s'],
            [tr('Heading', 'Kurs'), position?.headingDegrees?.value, '°'],
            [
              tr('Last position', 'Ostatnia pozycja'),
              mode === 'debug' && position
                ? clock(position.observedAt)
                : age < 120
                  ? age
                  : Math.floor(age / 60),
              mode === 'debug' ? '' : age < 120 ? 's' : 'min',
            ],
          ].map(([label, v, u]) => (
            <div key={String(label)}>
              <small>{String(label)}</small>
              <b title={position?.observedAt}>
                {String(v ?? '—')} {String(u)}
              </b>
            </div>
          ))}
        </div>
        {position && <small className="source-contact">ADS-B · {tr('last contact', 'ostatni kontakt')} <time dateTime={position.observedAt}>{clock(position.observedAt)}</time></small>}
        <small>Airframes · {f ? states[f.airframes] : tr('Loading…', 'Wczytywanie…')}</small>
      </div>
      {error && <p role="alert">{error}</p>}
      {view !== 'flight' && (
        <div className="flight-subview">
          <button onClick={() => setView('flight')}>{tr('← Back to flight', '← Wstecz')}</button>
          {view === 'route' && f && (
            <>
              <h2>
                {f.origin || '?'} → {f.destination || '?'}
              </h2>
              {f.related.map((r) => (
                <button
                  key={r.id}
                  onClick={async () => {
                    try {
                      const d = await request<Flight>(mode, 'flights/' + r.id);
                      if (current.current) {
                        select(d.item);
                        setView('flight');
                      }
                    } catch {
                      setError(tr('Flight unavailable', 'Lot niedostępny'));
                    }
                  }}
                >
                  {r.callsign} · {r.aircraft} · {new Date(r.start * 1000).toLocaleDateString()}
                </button>
              ))}
              {f.corridors.map((c, i) => (
                <section key={c.id}>
                  <h3>
                    {tr('Corridor','Korytarz')} {i + 1} · {c.width} km
                  </h3>
                  <p>{c.members[a.flightId!] === 'passage' ? tr('Confirmed passage','Potwierdzone przejście') : c.members[a.flightId!] ? tr('Observed inside corridor','Obserwacja w korytarzu') : tr('No observed contact','Brak obserwacji')}</p>
                  <button
                    onClick={() => {
                      overlay(corridor?.id === c.id ? undefined : c);
                      setFilter(false);
                    }}
                  >
                    {corridor?.id === c.id ? tr('Hide corridor','Ukryj korytarz') : tr('Show corridor','Pokaż korytarz')}
                  </button>
                  <button
                    onClick={() => {
                      overlay(c);
                      setFilter(!(corridor?.id === c.id && filter));
                    }}
                  >
                    {corridor?.id === c.id && filter ? tr('Show all flights', 'Pokaż wszystkie loty') : tr('Show flights using corridor', 'Pokaż korzystające loty')}
                  </button>
                </section>
              ))}
            </>
          )}
          {view === 'rules' && (
            <>
              <h2>{tr('Listening target', 'Cel nasłuchu')}</h2>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
                aria-label="Listening target"
              >
                {Object.entries(targets).map(([k, label]) => (
                  <option
                    key={k}
                    value={k}
                    disabled={
                      (k === 'route' && !(f?.origin && f.destination)) ||
                      (k === 'corridor' && !f?.corridors.length)
                    }
                  >
                    {label}
                  </option>
                ))}
              </select>
              {kind === 'corridor' && (
                <select aria-label="Corridor" value={corridorId} onChange={(e) => setVariant(e.target.value)}>
                  {f?.corridors.map((c, i) => (
                    <option value={c.id} key={c.id}>
                      {tr('Corridor','Korytarz')} {i + 1}
                    </option>
                  ))}
                </select>
              )}
              <fieldset>
                <legend>{tr('Sources', 'Źródła')}</legend>
                {sources.map((s) => (
                  <label key={s}>
                    <input
                      type="checkbox"
                      checked={channels.includes(s)}
                      onChange={() =>
                        setChannels((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]))
                      }
                    />
                    {s}
                  </label>
                ))}
              </fieldset>
              <p>
                {targets[kind]} ·{' '}
                {channels.map((c) => (c === 'ADS-B' ? tr('positions', 'pozycje') : tr('frames', 'ramki'))).join(tr(' and ', ' i '))}
              </p>
              <button
                className="track-action"
                disabled={!f || saving || !channels.length || saved}
                onClick={() => void save(kind, channels, true, target ?? undefined)}
              >
                {saved ? tr('Saved', 'Zapisano') : tr('Save listener', 'Zapisz nasłuch')}
              </button>
              {mode === 'live' && legacy.length > 0 && (
                <fieldset>
                  <legend>{tr('Local aircraft selections', 'Lokalne wybory maszyn')}</legend>
                  {legacy.map((id) => (
                    <button key={id} onClick={() => void migrate(id)} disabled={saving}>
                      {tr('Import','Przenieś')} {id} · {tr('positions and frames','pozycje i ramki')}
                    </button>
                  ))}
                </fieldset>
              )}
              {f?.rules.map(ruleRow)}
            </>
          )}
        </div>
      )}
      <Stream mode={mode} path={path} hidden={view !== 'flight'} />
    </>
  );
}
