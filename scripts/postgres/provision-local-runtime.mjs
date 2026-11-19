import { Pool } from 'pg';

const adminValue = process.env.MIGRATION_DATABASE_URL;
const runtimeValue = process.env.RUNTIME_DATABASE_URL;
if (!adminValue || !runtimeValue)
  throw new Error('MIGRATION_DATABASE_URL and RUNTIME_DATABASE_URL are required for local role provisioning.');
const adminUrl = new URL(adminValue), runtimeUrl = new URL(runtimeValue);
if (![adminUrl, runtimeUrl].every(url => ['postgres:', 'postgresql:'].includes(url.protocol))
    || !['127.0.0.1', 'localhost', '[::1]'].includes(adminUrl.hostname)
    || adminUrl.hostname !== runtimeUrl.hostname || adminUrl.port !== runtimeUrl.port
    || adminUrl.pathname !== '/terminal_velocity_dev' || runtimeUrl.pathname !== adminUrl.pathname
    || runtimeUrl.username !== 'tv_local_runtime' || !runtimeUrl.password
    || adminUrl.search || runtimeUrl.search || adminUrl.hash || runtimeUrl.hash)
  throw new Error('Local provisioning requires the same loopback terminal_velocity_dev database and tv_local_runtime login.');
const pool = new Pool({ connectionString: adminValue, max: 1, connectionTimeoutMillis: 5_000 });
try {
  const existing = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = 'tv_local_runtime'");
  if (existing.rowCount) throw new Error('tv_local_runtime already exists; this helper does not rotate credentials.');
  const formatted = await pool.query("SELECT format('CREATE ROLE tv_local_runtime LOGIN PASSWORD %L IN ROLE tv_runtime', $1::text) AS statement",
    [decodeURIComponent(runtimeUrl.password)]);
  await pool.query(formatted.rows[0].statement);
  console.log('Created the local runtime login with tv_runtime permissions.');
} finally { await pool.end(); }
