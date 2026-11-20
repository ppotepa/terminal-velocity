import { useState } from 'react';
import { Button } from './Button';
import { Panel } from './Panel';
import { StatusPill } from './StatusPill';
import { EmptyState } from './EmptyState';
import { LoadingState, ErrorState, InlineNotice } from './AsyncState';
import { DataTable } from './DataTable';
import { Modal } from './Modal';
import { TextField } from '../forms/TextField';
import { SelectField } from '../forms/SelectField';
import { Toggle } from '../forms/Toggle';

type ExampleRow = { name: string; status: string };
const rows: ExampleRow[] = [{ name: 'Synthetic position sample', status: 'Observed' }];
export function ComponentGallery() {
  const [enabled, setEnabled] = useState(true); const [modalOpen, setModalOpen] = useState(false);
  return <main className="component-gallery"><h1>Shared UI gallery</h1><p>Keyboard-ready examples for feature screens.</p><Panel title="Actions and status"><Button variant="primary">Primary action</Button> <Button>Secondary action</Button> <StatusPill tone="synthetic">Synthetic</StatusPill> <StatusPill tone="warning">Unknown</StatusPill></Panel><Panel title="Form controls"><TextField label="Rule name" name="rule-name" placeholder="My watch rule" description="A name only you will see." /><SelectField label="Collection window" name="window" options={[{value:'now',label:'From now'},{value:'backfill',label:'Include backfill'}]} /><Toggle label="Collect messages" checked={enabled} onChange={setEnabled} /></Panel><Panel title="Read states"><DataTable caption="Example sources" rows={rows} getRowKey={(row) => row.name} columns={[{key:'name',header:'Source',render:(row) => row.name},{key:'status',header:'State',render:(row) => <StatusPill tone="info">{row.status}</StatusPill>}]} /><LoadingState /><ErrorState message="The local API did not respond." onRetry={() => undefined} /><InlineNotice tone="warning">Provider access is not configured.</InlineNotice><EmptyState title="No messages observed" description="Messages appear when a selected source provides them." /></Panel><Button onClick={() => setModalOpen(true)}>Open dialog</Button><Modal open={modalOpen} title="Example dialog" description="Escape closes this keyboard accessible example." onClose={() => setModalOpen(false)} footer={<Button variant="primary" onClick={() => setModalOpen(false)}>Done</Button>}>Dialog content belongs here.</Modal></main>;
}
