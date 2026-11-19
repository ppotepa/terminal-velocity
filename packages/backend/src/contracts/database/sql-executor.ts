/** The small driver-independent SQL capability shared by transactional adapters. */
export interface SqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string, values?: unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}
