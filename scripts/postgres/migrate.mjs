import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const migrationDirectory = fileURLToPath(new URL('../../db/migrations/', import.meta.url));

/** Apply checked-in SQL once, under a database-wide lock, using an administrative connection. */
export async function applyMigrations(pool, directory = migrationDirectory) {
  const files = (await readdir(directory)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  const migrations = await Promise.all(files.map(async name => {
    const sql = await readFile(resolve(directory, name), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('terminal-velocity:migrations', 0))");
    await client.query('CREATE SCHEMA IF NOT EXISTS tv_migrations');
    await client.query('REVOKE ALL ON SCHEMA tv_migrations FROM PUBLIC');
    await client.query(`CREATE TABLE IF NOT EXISTS tv_migrations.applied (
      name text PRIMARY KEY, checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    const existing = new Map((await client.query('SELECT name, checksum FROM tv_migrations.applied')).rows
      .map(row => [row.name, row.checksum]));
    if ([...existing.keys()].some(name => !files.includes(name)))
      throw new Error('The database has a migration that is missing from this checkout.');
    const applied = [];
    for (const migration of migrations) {
      if (existing.has(migration.name)) {
        if (existing.get(migration.name) !== migration.checksum)
          throw new Error(`Migration checksum mismatch: ${migration.name}`);
        continue;
      }
      await client.query(migration.sql);
      await client.query('INSERT INTO tv_migrations.applied (name, checksum) VALUES ($1, $2)',
        [migration.name, migration.checksum]);
      applied.push(migration.name);
    }
    await client.query('COMMIT');
    return applied;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally {
    client.release(discard);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.MIGRATION_DATABASE_URL) {
    console.error('MIGRATION_DATABASE_URL is required. The API never runs migrations.');
    process.exitCode = 1;
  } else {
    const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1,
      connectionTimeoutMillis: 5_000, application_name: 'terminal-velocity-migrator' });
    try {
      const applied = await applyMigrations(pool);
      console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Migrations are current.');
    } catch (error) {
      console.error(`Migration failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  }
}
