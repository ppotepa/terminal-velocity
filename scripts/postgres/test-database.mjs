import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { applyMigrations } from './migrate.mjs';

export function requireTestDatabaseUrl(value) {
  if (!value) throw new Error('TEST_DATABASE_URL is required. Use an isolated loopback PostgreSQL test instance.');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || !/^\/tv_test_[a-zA-Z0-9_-]+$/.test(url.pathname)
      || !/^tv_test_[a-zA-Z0-9_-]+$/.test(decodeURIComponent(url.username))
      || url.search || url.hash)
    throw new Error('TEST_DATABASE_URL must target a loopback tv_test_* database with a tv_test_* administrative login.');
  return url;
}

/** Only the randomly named database and login created here are removed during cleanup. */
export async function createTestDatabase(baseConnectionString) {
  const baseUrl = requireTestDatabaseUrl(baseConnectionString);
  const suffix = randomBytes(8).toString('hex');
  const database = `tv_test_${suffix}`;
  const login = `tv_test_runtime_${suffix}`;
  const password = randomBytes(24).toString('hex');
  const admin = new Pool({ connectionString: baseUrl.href, max: 1, connectionTimeoutMillis: 5_000 });
  admin.on('error', () => {}); // Active operations reject; closing idle clients may report 57P01.
  const databaseUrl = new URL(baseUrl); databaseUrl.pathname = `/${database}`;
  const runtimeUrl = new URL(databaseUrl); runtimeUrl.username = login; runtimeUrl.password = password;
  let createdDatabase = false, createdLogin = false;
  async function close() {
    try {
      if (createdDatabase) {
        await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
        createdDatabase = false;
      }
      if (createdLogin) {
        await admin.query(`DROP ROLE "${login}"`);
        createdLogin = false;
      }
    } finally { await admin.end(); }
  }
  try {
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    createdDatabase = true;
    const migrationPool = new Pool({ connectionString: databaseUrl.href, max: 1 });
    migrationPool.on('error', () => {});
    try { await applyMigrations(migrationPool); } finally { await migrationPool.end(); }
    // Both generated values contain only hexadecimal or fixed ASCII characters.
    await admin.query(`CREATE ROLE "${login}" LOGIN PASSWORD '${password}' IN ROLE tv_runtime`);
    createdLogin = true;
    return { name: database, adminUrl: databaseUrl.href, runtimeUrl: runtimeUrl.href, close };
  } catch (error) {
    await close();
    throw error;
  }
}
