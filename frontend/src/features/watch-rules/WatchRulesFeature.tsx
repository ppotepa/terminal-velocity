import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CirclePlus, Pencil, RotateCw, Trash2 } from 'lucide-react';
import type { components } from '../../shared/api/generated';
import { createApiClient, normalizeApiFailure, type ApiClient } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { DataTable } from '../../shared/ui/DataTable';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorState, InlineNotice, LoadingState } from '../../shared/ui/AsyncState';
import { Modal } from '../../shared/ui/Modal';
import { Panel } from '../../shared/ui/Panel';
import { StatusPill } from '../../shared/ui/StatusPill';
import { SelectField } from '../../shared/forms/SelectField';
import { TextField } from '../../shared/forms/TextField';
import { Toggle } from '../../shared/forms/Toggle';
import './watch-rules.css';

type Rule = components['schemas']['WatchRule'];
type RuleInput = components['schemas']['WatchRuleInput'];
type Criterion = components['schemas']['Criterion'];
type Kind = NonNullable<Criterion['kind']>;
type Group = { mode: 'any' | 'all'; criteria: Criterion[] };
const criterionKinds: { value: Kind; label: string }[] = [
  { value: 'icao24', label: 'ICAO24' }, { value: 'registration', label: 'Registration' },
  { value: 'callsign', label: 'Callsign pattern' }, { value: 'operator', label: 'Operator' },
  { value: 'origin', label: 'Origin airport' }, { value: 'destination', label: 'Destination airport' },
  { value: 'protocol', label: 'Message protocol' }, { value: 'area', label: 'Area reference' },
];
const emptyRule = (): RuleInput => ({ name: '', status: 'active', scope: 'targeted', groups: [{ mode: 'any', criteria: [{ kind: 'callsign', value: '' }] }], collection: { positions: true, messages: false, decoderIds: [] } });

export function WatchRulesFeature({ client: suppliedClient }: { client?: ApiClient }) {
  const client = useMemo(() => suppliedClient ?? createApiClient(), [suppliedClient]);
  const [rules, setRules] = useState<Rule[]>([]); const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState<string>();
  const [editing, setEditing] = useState<Rule | null>(null); const [isCreating, setIsCreating] = useState(false); const [form, setForm] = useState<RuleInput>(emptyRule());
  const [formError, setFormError] = useState<string>(); const [saving, setSaving] = useState(false); const [actionError, setActionError] = useState<string>();
  const unsupported = useMemo(() => rules.flatMap((rule) => rule.groups.flatMap((group) => group.criteria.filter((criterion) => !criterionKinds.some((kind) => kind.value === criterion.kind)).map((criterion) => criterion.kind))), [rules]);

  const refresh = useCallback(async () => {
    setLoading(true); setLoadError(undefined);
    try {
      const result = await client.GET('/watch-rules', { params: { query: { limit: 100 } } });
      if (result.error) throw normalizeApiFailure(result.error, result.response.status);
      setRules(result.data?.items ?? []);
    } catch (error) { setLoadError(normalizeApiFailure(error).message); }
    finally { setLoading(false); }
  }, [client]);
  useEffect(() => { void refresh(); }, [refresh]);

  const beginCreate = () => { setEditing(null); setForm(emptyRule()); setFormError(undefined); setIsCreating(true); };
  const beginEdit = (rule: Rule) => { setEditing(rule); setForm({ name: rule.name, status: rule.status, scope: rule.scope, groups: rule.groups.map((group) => ({ mode: group.mode, criteria: group.criteria.map((criterion) => ({ ...criterion })) })), window: rule.window, discovery: rule.discovery, collection: { ...rule.collection, decoderIds: [...rule.collection.decoderIds] } }); setFormError(undefined); setIsCreating(true); };
  const updateForm = (patch: Partial<RuleInput>) => setForm((current) => ({ ...current, ...patch }));
  const updateGroup = (groupIndex: number, patch: Partial<Group>) => updateForm({ groups: form.groups.map((group, index) => index === groupIndex ? { ...group, ...patch } : group) });
  const updateCriterion = (groupIndex: number, criterionIndex: number, patch: Partial<Criterion>) => updateGroup(groupIndex, { criteria: form.groups[groupIndex].criteria.map((criterion, index) => index === criterionIndex ? { ...criterion, ...patch } : criterion) });

  const validate = (): string | undefined => {
    if (!form.name.trim()) return 'Enter a name for this Watch Rule.';
    if (!form.groups.length || form.groups.some((group) => !group.criteria.length)) return 'Each condition group needs at least one condition.';
    for (const group of form.groups) for (const criterion of group.criteria) {
      if (!criterionKinds.some((kind) => kind.value === criterion.kind)) return `The condition “${criterion.kind}” is not supported by this editor. Keep it in the existing rule or edit it through a supported field.`;
      if (!criterion.value.trim()) return 'Every condition needs a value.';
      if (criterion.kind === 'callsign' && (criterion.value.includes('*') && (!criterion.value.endsWith('*') || criterion.value.indexOf('*') !== criterion.value.length - 1))) return 'A callsign wildcard may appear once, at the end of the value.';
    }
    return undefined;
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); const invalid = validate(); setFormError(invalid); if (invalid) return;
    setSaving(true); setActionError(undefined);
    try {
      const payload: RuleInput = { ...form, name: form.name.trim(), groups: form.groups.map((group) => ({ ...group, criteria: group.criteria.map((criterion) => ({ ...criterion, value: criterion.value.trim() })) })) };
      const result = editing ? await client.PUT('/watch-rules/{ruleId}', { params: { path: { ruleId: editing.id } }, body: payload }) : await client.POST('/watch-rules', { body: payload });
      if (result.error) throw normalizeApiFailure(result.error, result.response.status);
      setIsCreating(false); await refresh();
    } catch (error) { setFormError(error instanceof Error ? error.message : normalizeApiFailure(error).message); }
    finally { setSaving(false); }
  };
  const changeStatus = async (rule: Rule, status: 'active' | 'paused') => {
    setActionError(undefined);
    try { const result = await client.PUT('/watch-rules/{ruleId}', { params: { path: { ruleId: rule.id } }, body: { name: rule.name, status, scope: rule.scope, groups: rule.groups, window: rule.window, discovery: rule.discovery, collection: rule.collection } }); if (result.error) throw normalizeApiFailure(result.error, result.response.status); await refresh(); }
    catch (error) { setActionError(error instanceof Error ? error.message : normalizeApiFailure(error).message); }
  };
  const remove = async (rule: Rule) => {
    if (!window.confirm(`Remove “${rule.name}”? This removes the rule from your watchlist.`)) return;
    setActionError(undefined);
    try { const result = await client.DELETE('/watch-rules/{ruleId}', { params: { path: { ruleId: rule.id } } }); if (result.error) throw normalizeApiFailure(result.error, result.response.status); await refresh(); }
    catch (error) { setActionError(error instanceof Error ? error.message : normalizeApiFailure(error).message); }
  };
  const addCriterion = (groupIndex: number) => updateGroup(groupIndex, { criteria: [...form.groups[groupIndex].criteria, { kind: 'callsign', value: '' }] });
  const addGroup = () => updateForm({ groups: [...form.groups, { mode: 'any', criteria: [{ kind: 'callsign', value: '' }] }] });

  return <div className="watch-rules-feature"><Panel title="Watch Rules" description="Choose the aircraft and flights the backend should observe." action={<div className="watch-actions"><Button size="sm" onClick={() => void refresh()} aria-label="Refresh Watch Rules"><RotateCw size={14} /></Button><Button variant="primary" size="sm" onClick={beginCreate}><CirclePlus size={14} /> New Watch Rule</Button></div>}>
    <InlineNotice>Acquisition scope and provider limits are decided by the API. Broad or unsupported requests are reported by the server; this screen never starts a global search.</InlineNotice>
    {actionError && <div className="watch-inline-error" role="alert">{actionError}</div>}
    {unsupported.length > 0 && <InlineNotice tone="warning">This list contains unsupported condition kinds: {Array.from(new Set(unsupported)).join(', ')}. Their values are preserved; this editor will not silently remove them.</InlineNotice>}
    {loading ? <LoadingState label="Loading Watch Rules" /> : loadError ? <ErrorState title="Watch Rules could not be loaded" message={loadError} onRetry={() => void refresh()} /> : rules.length === 0 ? <EmptyState title="No Watch Rules yet" description="Add a targeted rule to select aircraft and collection preferences." action={<Button variant="primary" onClick={beginCreate}>Create a Watch Rule</Button>} /> : <DataTable caption="Watch Rules" rows={rules} getRowKey={(rule) => rule.id} columns={[
      { key: 'name', header: 'Rule', render: (rule) => <div className="rule-name-cell"><strong>{rule.name}</strong><small>{rule.groups.map((group) => group.criteria.map((criterion) => `${criterion.kind}: ${criterion.value}`).join(` ${group.mode.toUpperCase()} `)).join(' · ') || 'No conditions'}</small></div> },
      { key: 'status', header: 'Status', render: (rule) => <StatusPill tone={rule.status === 'active' ? 'positive' : 'neutral'}>{rule.status}</StatusPill> },
      { key: 'collection', header: 'Collect', render: (rule) => <span>{[rule.collection.positions && 'positions', rule.collection.messages && 'messages'].filter(Boolean).join(' + ') || 'none'}</span> },
      { key: 'actions', header: 'Actions', align: 'end', render: (rule) => <div className="rule-row-actions"><Button size="sm" onClick={() => beginEdit(rule)} aria-label={`Edit ${rule.name}`}><Pencil size={13} /></Button><Button size="sm" onClick={() => void changeStatus(rule, rule.status === 'active' ? 'paused' : 'active')}>{rule.status === 'active' ? 'Pause' : 'Enable'}</Button><Button variant="danger" size="sm" onClick={() => void remove(rule)} aria-label={`Remove ${rule.name}`}><Trash2 size={13} /></Button></div> },
    ]} />}
  </Panel>
  <Modal open={isCreating} title={editing ? 'Edit Watch Rule' : 'Create Watch Rule'} description="Only criteria selected here are used to scope acquisition." onClose={() => setIsCreating(false)}>
    <form className="watch-rule-form" onSubmit={(event) => void save(event)}>
      <TextField label="Rule name" name="rule-name" maxLength={120} value={form.name} onChange={(event) => updateForm({ name: event.target.value })} required />
      <div className="condition-heading"><h3>Conditions</h3><Button size="sm" onClick={addGroup}>Add group</Button></div>
      {form.groups.map((group, groupIndex) => <fieldset className="condition-group" key={groupIndex}><legend>Group {groupIndex + 1}</legend><SelectField label="Match within this group" name={`group-${groupIndex}-mode`} value={group.mode} options={[{ value: 'any', label: 'ANY condition' }, { value: 'all', label: 'ALL conditions' }]} onChange={(event) => updateGroup(groupIndex, { mode: event.target.value as Group['mode'] })} />{group.criteria.map((criterion, criterionIndex) => <div className="criterion-row" key={criterionIndex}><SelectField label="Field" name={`kind-${groupIndex}-${criterionIndex}`} value={criterion.kind} options={criterionKinds} onChange={(event) => updateCriterion(groupIndex, criterionIndex, { kind: event.target.value as Kind })} /><TextField label="Value" name={`value-${groupIndex}-${criterionIndex}`} value={criterion.value} maxLength={128} placeholder={criterion.kind === 'callsign' ? 'UAL*' : 'Enter value'} description={criterion.kind === 'callsign' ? 'Use one * only at the end for a callsign prefix.' : undefined} onChange={(event) => updateCriterion(groupIndex, criterionIndex, { value: event.target.value })} /><Button variant="quiet" size="sm" aria-label="Remove condition" disabled={group.criteria.length < 2} onClick={() => updateGroup(groupIndex, { criteria: group.criteria.filter((_, index) => index !== criterionIndex) })}>×</Button></div>)}<Button size="sm" onClick={() => addCriterion(groupIndex)}>Add condition</Button></fieldset>)}
      <fieldset className="collection-group"><legend>Collection preferences</legend><Toggle label="Collect positions" checked={form.collection.positions} onChange={(positions) => updateForm({ collection: { ...form.collection, positions } })} /><Toggle label="Collect messages" checked={form.collection.messages} onChange={(messages) => updateForm({ collection: { ...form.collection, messages } })} /><TextField label="Decoder IDs" name="decoder-ids" value={form.collection.decoderIds.join(', ')} placeholder="acars-basic" description="Comma-separated decoder IDs. These are applied only when message collection is enabled." onChange={(event) => updateForm({ collection: { ...form.collection, decoderIds: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) } })} /></fieldset>
      {formError && <div className="watch-inline-error" role="alert">{formError}</div>}
      <div className="watch-form-footer"><Button onClick={() => setIsCreating(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving…' : 'Save Watch Rule'}</Button></div>
    </form>
  </Modal>
  </div>;
}
