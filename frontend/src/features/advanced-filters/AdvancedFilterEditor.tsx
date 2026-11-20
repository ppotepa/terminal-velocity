import type { components } from '../../shared/api/generated';
import { InlineNotice } from '../../shared/ui/AsyncState';
import { Panel } from '../../shared/ui/Panel';
import { StatusPill } from '../../shared/ui/StatusPill';
import { SelectField } from '../../shared/forms/SelectField';
import { TextField } from '../../shared/forms/TextField';
import './advanced-filters.css';

type WatchRuleInput = components['schemas']['WatchRuleInput'];
type Criterion = components['schemas']['Criterion'];
type CriterionKind = Criterion['kind'];
type Props = { value: WatchRuleInput; onChange: (value: WatchRuleInput) => void; discoveryAllowed?: boolean };

/** Controlled advanced WatchRule fields; serialized values stay within the backend-owned schema. */
export function AdvancedFilterEditor({ value, onChange, discoveryAllowed = true }: Props) {
  const getCriterion = (kind: CriterionKind) => value.groups.flatMap((group) => group.criteria).find((criterion) => criterion.kind === kind)?.value ?? '';
  const setCriterion = (kind: CriterionKind, next: string) => {
    const currentGroup = value.groups.findIndex((group) => group.criteria.some((criterion) => criterion.kind === kind));
    let groups = value.groups.map((group) => ({ ...group, criteria: group.criteria.filter((criterion) => criterion.kind !== kind) }));
    if (next.trim()) {
      if (currentGroup >= 0) groups[currentGroup] = { ...value.groups[currentGroup], criteria: [...groups[currentGroup].criteria, { kind, value: next.trim() }] };
      else if (groups.length) groups[0] = { ...groups[0], criteria: [...groups[0].criteria, { kind, value: next.trim() }] };
      else groups = [{ mode: 'all', criteria: [{ kind, value: next.trim() }] }];
    } else groups = groups.filter((group) => group.criteria.length > 0);
    onChange({ ...value, groups });
  };
  const setDiscovery = (field: 'areaId' | 'maxCandidates', next: string) => {
    const discovery = { areaId: value.discovery?.areaId ?? '', maxCandidates: value.discovery?.maxCandidates ?? 100 };
    const updated = field === 'areaId' ? { ...discovery, areaId: next.trim() } : { ...discovery, maxCandidates: Number(next) };
    onChange({ ...value, scope: 'area_discovery', discovery: updated });
  };
  const useTargeted = () => onChange({ ...value, scope: 'targeted', discovery: null });
  const useAreaDiscovery = () => onChange({ ...value, scope: 'area_discovery', discovery: value.discovery ?? { areaId: '', maxCandidates: 100 } });
  const discoveryEnabled = value.scope === 'area_discovery';

  return <div className="advanced-filter-editor">
    <Panel title="Route and operator criteria" description="These criteria are stored with the Watch Rule. The current source query planner does not translate them into provider lookups.">
      <InlineNotice tone="warning">The API currently prefilters only ICAO24, registration, and callsign. Origin, destination, and operator values can be saved, but provider coverage and local post-filter results are not exposed by this runtime. Adding them will not trigger a broad source query.</InlineNotice>
      <div className="advanced-filter-grid"><TextField label="Departure airport code" name="advanced-origin" value={getCriterion('origin')} placeholder="e.g. WAW" maxLength={128} description="Saved as an origin criterion; no provider prefilter is currently available." onChange={(event) => setCriterion('origin', event.target.value)} /><TextField label="Arrival airport code" name="advanced-destination" value={getCriterion('destination')} placeholder="e.g. FRA" maxLength={128} description="Saved as a destination criterion; no provider prefilter is currently available." onChange={(event) => setCriterion('destination', event.target.value)} /><TextField label="Operator" name="advanced-operator" value={getCriterion('operator')} placeholder="Operator name or code" maxLength={128} description="Stored only; provider query support is not advertised." onChange={(event) => setCriterion('operator', event.target.value)} /></div>
    </Panel>
    <Panel title="Bounded area discovery" description="Use only for a source-supported area ID and a hard candidate limit.">
      {!discoveryAllowed && <InlineNotice tone="warning">Area discovery is not advertised by the current source capability response.</InlineNotice>}
      <div className="advanced-filter-switch"><SelectField label="Collection mode" name="advanced-scope" value={discoveryEnabled ? 'area_discovery' : 'targeted'} options={[{value:'targeted',label:'Target known identifiers'},{value:'area_discovery',label:'Discover within an area'}]} disabled={!discoveryAllowed} onChange={(event) => event.target.value === 'area_discovery' ? useAreaDiscovery() : useTargeted()} /><StatusPill tone={discoveryEnabled ? 'warning' : 'positive'}>{discoveryEnabled ? 'candidate-limited' : 'targeted'}</StatusPill></div>
      {discoveryEnabled && <div className="advanced-filter-grid"><TextField label="Source area ID" name="discovery-area" value={value.discovery?.areaId ?? ''} placeholder="Area ID supported by your source" maxLength={128} required description="This is a provider-defined ID, not an uploaded polygon or arbitrary global query." onChange={(event) => setDiscovery('areaId', event.target.value)} /><TextField label="Maximum candidates" name="discovery-limit" type="number" min={1} max={1000} value={String(value.discovery?.maxCandidates ?? 100)} required onChange={(event) => setDiscovery('maxCandidates', event.target.value)} /><InlineNotice>Requests remain bounded by both this limit and the source capability maximum. The API reports unsupported areas or budgets.</InlineNotice></div>}
    </Panel>
    <Panel title="Geographic and altitude filters" description="The current WatchRule contract has no fields for these shapes or thresholds.">
      <ul className="unsupported-filter-list"><li><span>Country crossing</span><StatusPill tone="warning">Not in API</StatusPill><small>Visited-country rules cannot be saved from this editor.</small></li><li><span>Bounding box, radius, or GeoJSON geofence</span><StatusPill tone="warning">Not in API</StatusPill><small>No unsupported polygon is sent or silently reduced to an area ID.</small></li><li><span>Flight-path and altitude thresholds</span><StatusPill tone="warning">Not in API</StatusPill><small>These conditions require a backend contract and query-planner extension first.</small></li></ul>
    </Panel>
  </div>;
}
