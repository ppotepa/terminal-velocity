import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { Client } from 'pg';

const execute = promisify(execFile);

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

/** Start real installed binaries; no download, Docker daemon, or existing database is required. */
export async function startLocalPostgres() {
  if (typeof process.getuid === 'function' && process.getuid() === 0)
    throw new Error('PostgreSQL initdb must run as an unprivileged user.');
  const workDirectory = process.env.TV_PG_WORK_DIR ?? tmpdir();
  await mkdir(workDirectory, { recursive: true });
  const directory = await mkdtemp(join(workDirectory, 'tv-pg-'));
  const dataDirectory = join(directory, 'data');
  const passwordFile = join(directory, 'password');
  const logPath = join(directory, 'postgres.log');
  const binary = name => process.env.PG_BIN ? join(process.env.PG_BIN, name) : name;
  const password = randomBytes(24).toString('hex');
  const port = await unusedPort();
  const url = `postgresql://tv_test_admin:${password}@127.0.0.1:${port}/tv_test_bootstrap`;
  let server, serverExit, log;
  async function close() {
    try {
      if (server && server.exitCode === null && server.signalCode === null) {
        server.kill('SIGINT');
        const stopped = await Promise.race([serverExit.then(() => true), delay(10_000, undefined, { ref: false }).then(() => false)]);
        if (!stopped) { server.kill('SIGKILL'); await serverExit; }
      }
    } finally {
      if (log) { await log.close(); log = undefined; }
      await rm(directory, { recursive: true, force: true });
    }
  }
  try {
    await writeFile(passwordFile, `${password}\n`, { mode: 0o600 });
    const args = ['-D', dataDirectory, '-U', 'tv_test_admin', '--auth-local=trust',
      '--auth-host=scram-sha-256', `--pwfile=${passwordFile}`, '--encoding=UTF8', '--locale=C'];
    if (process.env.PG_SHARE_DIR) args.push('-L', process.env.PG_SHARE_DIR);
    await execute(binary('initdb'), args, { timeout: 30_000, maxBuffer: 2_000_000 });
    log = await open(logPath, 'w');
    server = spawn(binary('postgres'), ['-D', dataDirectory, '-h', '127.0.0.1', '-p', String(port),
      '-k', '', '-c', 'fsync=on', '-c', 'synchronous_commit=on', '-c', 'full_page_writes=on'],
    { stdio: ['ignore', log.fd, log.fd] });
    let startError;
    server.once('error', error => { startError = error; });
    serverExit = new Promise(resolve => {
      server.once('exit', resolve);
      server.once('error', resolve);
    });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (startError) throw startError;
      if (server.exitCode !== null || server.signalCode !== null)
        throw new Error(`PostgreSQL exited during startup. ${await readFile(logPath, 'utf8')}`);
      const client = new Client({ connectionString: url.replace('/tv_test_bootstrap', '/postgres'),
        connectionTimeoutMillis: 500 });
      let connected = false;
      try { await client.connect(); connected = true; }
      catch { /* The server has not opened its socket yet. */ }
      if (connected) {
        try {
          await client.query('CREATE DATABASE tv_test_bootstrap');
          const result = await client.query('SHOW server_version');
          console.log(`Started isolated PostgreSQL ${result.rows[0].server_version}; durability settings remain enabled.`);
        } finally { await client.end(); }
        return { url, close };
      }
      await client.end().catch(() => {});
      await delay(50);
    }
    throw new Error(`PostgreSQL did not become ready. ${await readFile(logPath, 'utf8')}`);
  } catch (error) {
    await close();
    throw error;
  }
}
