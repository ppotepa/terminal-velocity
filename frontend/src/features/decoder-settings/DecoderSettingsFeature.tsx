import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import type { components } from '../../shared/api/generated';
import { createApiClient, normalizeApiFailure, type ApiClient } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorState, InlineNotice, LoadingState } from '../../shared/ui/AsyncState';
import { Panel } from '../../shared/ui/Panel';
import { StatusPill } from '../../shared/ui/StatusPill';
import { SelectField } from '../../shared/forms/SelectField';
import { TextField } from '../../shared/forms/TextField';
import { Toggle } from '../../shared/forms/Toggle';
import './decoder-settings.css';

type Decoder = components['schemas']['Decoder'];
type DecoderConfig = components['schemas']['DecoderConfig'];
type DecodeResult = components['schemas']['DecodeResult'];
type WatchRule = components['schemas']['WatchRule'];
type Rule = DecoderConfig['rules'][number];
type Props = { client?: ApiClient };
const syntheticPayload = 'Q0 UAL52 MESSAGE: SYNTHETIC PREVIEW SAMPLE';

export function DecoderSettingsFeature({ client: suppliedClient }: Props) {
  const client = useMemo(() => suppliedClient ?? createApiClient(), [suppliedClient]);
  const [decoders, setDecoders] = useState<Decoder[]>([]); const [watchRules, setWatchRules] = useState<WatchRule[]>([]); const [selectedId, setSelectedId] = useState(''); const [config, setConfig] = useState<DecoderConfig>();
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [assignmentSaving, setAssignmentSaving] = useState<string>(); const [error, setError] = useState<string>(); const [assignmentError, setAssignmentError] = useState<string>(); const [saveMessage, setSaveMessage] = useState<string>();
  const [payload, setPayload] = useState(syntheticPayload); const [protocol, setProtocol] = useState(''); const [bearer, setBearer] = useState(''); const [preview, setPreview] = useState<DecodeResult>(); const [previewError, setPreviewError] = useState<string>(); const [previewing, setPreviewing] = useState(false);
  const selected = decoders.find((decoder) => decoder.id === selectedId);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(undefined);
    try {
      const [result, watchResult] = await Promise.all([client.GET('/decoders', { signal }), client.GET('/watch-rules', { params: { query: { limit: 100 } }, signal })]);
      if (!result.response.ok) throw new Error(`Decoder request failed (HTTP ${result.response.status}).`);
      const items = result.data ?? []; setDecoders(items);
      if (watchResult.error) setAssignmentError(normalizeApiFailure(watchResult.error, watchResult.response.status).message);
      else { setWatchRules(watchResult.data?.items ?? []); setAssignmentError(undefined); }
      if (items.length) setSelectedId((current) => items.some((decoder) => decoder.id === current) ? current : items[0].id);
    } catch (failure) { if (!(failure instanceof DOMException && failure.name === 'AbortError')) setError(normalizeApiFailure(failure).message); }
    finally { setLoading(false); }
  }, [client]);
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [refresh]);
  useEffect(() => { if (selected) { setConfig({ version: selected.version, enabled: selected.enabled, rules: selected.rules.map((rule) => ({ ...rule })) }); setProtocol(selected.capabilities.protocols[0] ?? ''); setBearer(selected.capabilities.bearers[0] ?? ''); setPreview(undefined); setPreviewError(undefined); setSaveMessage(undefined); } }, [selected]);

  const updateRule = (index: number, patch: Partial<Rule>) => setConfig((current) => current && ({ ...current, rules: current.rules.map((rule, i) => i === index ? { ...rule, ...patch } : rule) }));
  const addRule = () => setConfig((current) => current && ({ ...current, rules: [...current.rules, { field: selected?.fields[0]?.name ?? '', operator: 'equals', value: '' }] }));
  const removeRule = (index: number) => setConfig((current) => current && ({ ...current, rules: current.rules.filter((_, i) => i !== index) }));

  const assignToRule = async (rule: WatchRule, enabled: boolean) => {
    if (!selected) return;
    const decoderIds = enabled ? [...new Set([...rule.collection.decoderIds, selected.id])] : rule.collection.decoderIds.filter((id) => id !== selected.id);
    setAssignmentSaving(rule.id); setAssignmentError(undefined);
    try {
      const result = await client.PUT('/watch-rules/{ruleId}', { params: { path: { ruleId: rule.id } }, body: { name: rule.name, status: rule.status, scope: rule.scope, groups: rule.groups, window: rule.window, discovery: rule.discovery, collection: { ...rule.collection, decoderIds } } });
      if (result.error) throw normalizeApiFailure(result.error, result.response.status);
      setWatchRules((current) => current.map((item) => item.id === rule.id ? result.data! : item));
    } catch (failure) { setAssignmentError(normalizeApiFailure(failure).message); }
    finally { setAssignmentSaving(undefined); }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!selected || !config) return;
    if (config.rules.some((rule) => !rule.field || !rule.value.trim())) { setError('Every decoder rule needs a field and a value.'); return; }
    setSaving(true); setError(undefined); setSaveMessage(undefined);
    try {
      const result = await client.PUT('/decoders/{decoderId}', { params: { path: { decoderId: selected.id } }, body: { ...config, rules: config.rules.map((rule) => ({ ...rule, value: rule.value.trim() })) } });
      if (result.error) throw normalizeApiFailure(result.error, result.response.status);
      setDecoders((current) => current.map((decoder) => decoder.id === selected.id ? result.data! : decoder)); setSaveMessage('Decoder settings saved.');
    } catch (failure) { setError(normalizeApiFailure(failure).message); }
    finally { setSaving(false); }
  };
  const runPreview = async (event: FormEvent) => {
    event.preventDefault(); if (!selected || !payload.trim()) { setPreviewError('Enter a sample message to preview.'); return; }
    setPreviewing(true); setPreviewError(undefined); setPreview(undefined);
    try {
      const result = await client.POST('/decoders/{decoderId}/preview', { params: { path: { decoderId: selected.id } }, body: { payload, protocol: protocol || undefined, bearer: bearer || undefined } });
      if (result.error) throw normalizeApiFailure(result.error, result.response.status);
      setPreview(result.data);
    } catch (failure) { setPreviewError(normalizeApiFailure(failure).message); }
    finally { setPreviewing(false); }
  };

  if (loading) return <Panel title="Decoder settings"><LoadingState label="Loading decoder registry" /></Panel>;
  if (error && !decoders.length) return <Panel title="Decoder settings"><ErrorState title="Decoder registry unavailable" message={error} onRetry={() => void refresh()} /></Panel>;
  if (!decoders.length) return <Panel title="Decoder settings"><EmptyState title="No decoder registry entries" description="The backend has not returned any configured decoders." /></Panel>;
  return <section className="decoder-settings-feature"><Panel title="Decoder registry" description="Manage declarative settings and preview against a sample. No arbitrary code is executed." action={<SelectField label="Decoder" name="decoder-select" value={selectedId} options={decoders.map((decoder) => ({ value: decoder.id, label: `${decoder.name} · ${decoder.id}` }))} onChange={(event) => setSelectedId(event.target.value)} />}>
    {selected && config && <div className="decoder-settings-layout"><form className="decoder-config-form" onSubmit={(event) => void save(event)}><div className="decoder-summary"><div><strong>{selected.name}</strong><span>{selected.id} · v{selected.version}</span></div><StatusPill tone={config.enabled ? 'positive' : 'neutral'}>{config.enabled ? 'enabled' : 'disabled'}</StatusPill></div><div className="decoder-capabilities">Protocols: {selected.capabilities.protocols.join(', ') || 'none'} · Bearers: {selected.capabilities.bearers.join(', ') || 'none'}</div><div className="decoder-field-catalog"><strong>Structured fields</strong>{selected.fields.map((field) => <span key={field.name}>{field.name} <small>{field.type}{field.required ? ' · required' : ''}{field.unit ? ` · ${field.unit}` : ''}</small></span>)}</div><Toggle label="Enable decoder" description="Enabled decoder settings are used when a selected Watch Rule requests them." checked={config.enabled} onChange={(enabled) => setConfig({ ...config, enabled })} />
      <section className="decoder-assignment"><div className="decoder-rule-heading"><div><h3>Watch Rule assignments</h3><p>Assign only to rules with message collection enabled.</p></div></div>{assignmentError && <div className="decoder-error" role="alert">{assignmentError}</div>}{watchRules.length === 0 ? <p className="decoder-assignment-empty">No Watch Rules are available.</p> : watchRules.map((rule) => { const assigned = rule.collection.decoderIds.includes(selected.id); const canAssign = rule.collection.messages; return <div className="decoder-assignment-row" key={rule.id}><div><strong>{rule.name}</strong><span>{rule.status} · {canAssign ? 'message collection enabled' : 'message collection disabled'}</span></div><Toggle label={assigned ? 'Assigned' : 'Assign'} checked={assigned} disabled={!canAssign || assignmentSaving === rule.id} onChange={(enabled) => void assignToRule(rule, enabled)} /></div>; })}</section>
      <div className="decoder-rule-heading"><div><h3>Declarative field rules</h3><p>Only equals, prefix, and contains matching are supported.</p></div><Button size="sm" onClick={addRule}><Plus size={13} /> Add rule</Button></div>{config.rules.length === 0 && <InlineNotice>No additional field rules configured. Built-in parsing remains controlled by the backend decoder.</InlineNotice>}{config.rules.map((rule, index) => <div className="decoder-rule-row" key={`${selected.id}-${index}`}><SelectField label="Field" name={`decoder-field-${index}`} value={rule.field} options={selected.fields.map((field) => ({ value: field.name, label: field.name }))} onChange={(event) => updateRule(index, { field: event.target.value })} /><SelectField label="Match" name={`decoder-operator-${index}`} value={rule.operator} options={[{value:'equals',label:'Equals'},{value:'prefix',label:'Starts with'},{value:'contains',label:'Contains'}]} onChange={(event) => updateRule(index, { operator: event.target.value as Rule['operator'] })} /><TextField label="Value" name={`decoder-value-${index}`} maxLength={256} value={rule.value} onChange={(event) => updateRule(index, { value: event.target.value })} /><Button variant="danger" size="sm" aria-label={`Remove rule ${index + 1}`} onClick={() => removeRule(index)}><Trash2 size={13} /></Button></div>)}<div className="decoder-save-row"><Button type="submit" variant="primary" disabled={saving}><Save size={13} />{saving ? 'Saving…' : 'Save settings'}</Button>{saveMessage && <span role="status" className="decoder-saved">{saveMessage}</span>}{error && <span role="alert" className="decoder-error">{error}</span>}</div></form>
      <div className="decoder-preview"><div className="decoder-rule-heading"><div><h3>Preview</h3><p>Preview output is not persisted.</p></div></div><InlineNotice tone="warning">The starting payload is synthetic. Replace it with text you are authorized to inspect.</InlineNotice><form className="decoder-preview-form" onSubmit={(event) => void runPreview(event)}><label className="decoder-textarea-label" htmlFor="decoder-payload">Sample message</label><textarea id="decoder-payload" maxLength={65536} rows={5} value={payload} onChange={(event) => setPayload(event.target.value)} /><div className="decoder-preview-meta"><SelectField label="Protocol" name="preview-protocol" value={protocol} options={selected.capabilities.protocols.map((item) => ({ value: item, label: item }))} onChange={(event) => setProtocol(event.target.value)} /><SelectField label="Bearer" name="preview-bearer" value={bearer} options={selected.capabilities.bearers.map((item) => ({ value: item, label: item }))} onChange={(event) => setBearer(event.target.value)} /></div><Button type="submit" variant="secondary" disabled={previewing}>{previewing ? 'Previewing…' : 'Preview decoder'}</Button></form>{previewError && <div className="decoder-error" role="alert">{previewError}</div>}{preview && <PreviewResult result={preview} />}</div>
    </div>}
  </Panel></section>;
}

function PreviewResult({ result }: { result: DecodeResult }) {
  return <section className="preview-result" aria-live="polite"><header><strong>Preview result</strong><StatusPill tone={result.status === 'decoded' ? 'positive' : result.status === 'partial' ? 'warning' : 'neutral'}>{result.status}</StatusPill></header><p>{result.decoderId ?? 'Unknown decoder'}{result.decoderVersion ? ` · v${result.decoderVersion}` : ''}</p>{result.reason && <div className="decoder-preview-reason">{result.reason}</div>}{result.fields.length ? <dl>{result.fields.map((field) => <div key={field.name}><dt>{field.name}</dt><dd>{formatValue(field.value)}{field.unit ? ` ${field.unit}` : ''}</dd></div>)}</dl> : <div className="decoder-preview-reason">No structured fields returned. Original text remains available.</div>}</section>;
}
function formatValue(value: unknown): string { if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value); if (value == null) return 'Unknown'; try { return JSON.stringify(value); } catch { return 'Unrecognized value'; } }
