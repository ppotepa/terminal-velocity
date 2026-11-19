export type StorageConfig = { readonly driver: 'memory' }
  | { readonly driver: 'postgres'; readonly databaseUrl: string };

export function readStorageConfig(environment: Readonly<Record<string, string | undefined>>): StorageConfig {
  const driver = environment['STORAGE_DRIVER'] ?? 'memory';
  if (driver === 'memory') return { driver };
  if (driver !== 'postgres') throw new Error('STORAGE_DRIVER must be memory or postgres.');
  const databaseUrl = environment['DATABASE_URL'];
  if (!databaseUrl || databaseUrl !== databaseUrl.trim()) throw new Error('DATABASE_URL is required for PostgreSQL storage.');
  let parsed: URL;
  try { parsed = new URL(databaseUrl); } catch { throw new Error('DATABASE_URL must be a PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname || parsed.pathname === '/')
    throw new Error('DATABASE_URL must specify a PostgreSQL host and database.');
  return { driver, databaseUrl };
}
