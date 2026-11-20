import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';

type Column<Row> = { key: string; header: string; render: (row: Row) => ReactNode; align?: 'start' | 'end' };
type Props<Row> = { columns: Column<Row>[]; rows: Row[]; getRowKey: (row: Row) => string; caption: string; emptyTitle?: string; emptyDescription?: string };
export function DataTable<Row>({ columns, rows, getRowKey, caption, emptyTitle = 'Nothing here yet', emptyDescription = 'New items will appear here.' }: Props<Row>) {
  if (!rows.length) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return <div className="table-scroll"><table className="ui-table"><caption className="sr-only">{caption}</caption><thead><tr>{columns.map((column) => <th key={column.key} scope="col" className={column.align === 'end' ? 'cell-end' : ''}>{column.header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={getRowKey(row)}>{columns.map((column) => <td key={column.key} className={column.align === 'end' ? 'cell-end' : ''}>{column.render(row)}</td>)}</tr>)}</tbody></table></div>;
}
