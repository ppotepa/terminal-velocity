import type { ReactNode } from 'react';

export interface TableColumn<Row> {
  readonly key: string;
  readonly heading: string;
  readonly render: (row: Row) => ReactNode;
}
export interface DataTableProps<Row> {
  readonly caption: string;
  readonly rows: readonly Row[];
  readonly columns: readonly TableColumn<Row>[];
  readonly rowKey: (row: Row) => string;
  readonly empty?: string;
}

export function DataTable<Row>({ caption, rows, columns, rowKey, empty = 'No rows available.' }: DataTableProps<Row>) {
  return <div className="tv-table-scroll">
    <table className="tv-table">
      <caption>{caption}</caption>
      <thead><tr>{columns.map(column => <th key={column.key} scope="col">{column.heading}</th>)}</tr></thead>
      <tbody>{rows.length > 0 ? rows.map(row => <tr key={rowKey(row)}>
        {columns.map(column => <td key={column.key}>{column.render(row)}</td>)}
      </tr>) : <tr><td colSpan={Math.max(columns.length, 1)}>{empty}</td></tr>}</tbody>
    </table>
  </div>;
}
