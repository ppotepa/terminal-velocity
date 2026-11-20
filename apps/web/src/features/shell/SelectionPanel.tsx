import { useState, type FormEvent } from 'react';
import { Button } from '../../shared/ui/Button.tsx';
import { DataTable } from '../../shared/ui/DataTable.tsx';
import { Input } from '../../shared/ui/Input.tsx';
import { Panel } from '../../shared/ui/Panel.tsx';
import { StateMessage } from '../../shared/ui/StateMessage.tsx';
import type { MapLoadState } from '../../app/use-map-snapshot.ts';
import type { UrlState } from '../../app/url-state.ts';

interface SelectionPanelProps {
  readonly state: UrlState;
  readonly result: MapLoadState;
  readonly onChange: (next: UrlState) => void;
}

export function SelectionPanel({ state, result, onChange }: SelectionPanelProps) {
  const [draft, setDraft] = useState(state.aircraft);
  const [error, setError] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = draft.trim();
    if (next && !/^ac_[A-Za-z0-9-]{1,64}$/.test(next)) {
      setError('Use an aircraft ID beginning with ac_.');
      return;
    }
    setError('');
    onChange({ ...state, aircraft: next });
  };
  const rows = result.kind === 'loaded' ? [
    { label: 'Positions shown', value: String(result.snapshot.data.length) },
    { label: 'More pages', value: result.snapshot.nextCursor ? 'Yes' : 'No' },
  ] : [];
  return <Panel title="Selection" eyebrow="Aircraft" className="tv-panel--details">
    <form className="tv-details-form" onSubmit={submit}>
      <Input label="Aircraft ID" placeholder="ac_demo-001" value={draft}
        onChange={event => { setDraft(event.target.value); if (error) setError(''); }}
        error={error} hint="Enter a local aircraft ID to keep it in the URL." />
      <Button type="submit" variant="primary">Select aircraft</Button>
    </form>
    <hr className="tv-divider" />
    {state.aircraft ? <StateMessage kind="empty" title={`Selected ${state.aircraft}`}>
      Aircraft details are not available in this view yet.</StateMessage>
      : <StateMessage kind="empty" title="No aircraft selected">
        Select an aircraft to keep your place as you navigate.</StateMessage>}
    {result.kind === 'loaded' ? <div className="tv-overview">
      <hr className="tv-divider" />
      <DataTable caption="Viewport summary" rows={rows} rowKey={row => row.label}
        columns={[{ key: 'label', heading: 'Measure', render: row => row.label },
          { key: 'value', heading: 'Value', render: row => row.value }]} />
    </div> : null}
  </Panel>;
}
