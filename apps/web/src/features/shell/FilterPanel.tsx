import { Panel } from '../../shared/ui/Panel.tsx';
import { Select } from '../../shared/ui/Select.tsx';
import type { UrlState } from '../../app/url-state.ts';

interface FilterPanelProps { readonly state: UrlState; readonly onChange: (next: UrlState) => void }

export function FilterPanel({ state, onChange }: FilterPanelProps) {
  return <Panel title="Filters" eyebrow="Viewport" className="tv-panel--filters">
    <div className="tv-filter-stack">
      <Select label="Position status" value={state.positionStatus}
        onChange={event => onChange({ ...state, positionStatus: event.target.value as UrlState['positionStatus'] })}
        options={[{ value: '', label: 'All positions' }, { value: 'CURRENT', label: 'Current' },
          { value: 'STALE', label: 'Stale' }, { value: 'UNKNOWN', label: 'Unknown' }]} />
      <Select label="Message status" value={state.messageStatus}
        onChange={event => onChange({ ...state, messageStatus: event.target.value as UrlState['messageStatus'] })}
        options={[{ value: '', label: 'All statuses' }, { value: 'RECENT', label: 'Recent' },
          { value: 'STALE', label: 'Stale' }, { value: 'NONE', label: 'None' }]} />
      <Select label="Protocol" value={state.protocol}
        onChange={event => onChange({ ...state, protocol: event.target.value as UrlState['protocol'] })}
        options={[{ value: '', label: 'All protocols' }, { value: 'VHF_ACARS', label: 'VHF ACARS' },
          { value: 'VDL2', label: 'VDL2' }, { value: 'HFDL', label: 'HFDL' },
          { value: 'SATCOM', label: 'SATCOM' }]} />
      <p className="tv-status-note">These filters apply to the private local viewport.</p>
    </div>
  </Panel>;
}
