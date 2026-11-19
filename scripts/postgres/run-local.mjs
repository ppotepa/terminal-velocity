import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startLocalPostgres } from './local-postgres.mjs';

let server;
try {
  server = await startLocalPostgres();
  const child = spawn(process.execPath, [fileURLToPath(new URL('./run-integration.mjs', import.meta.url))], {
    stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: server.url },
  });
  const forwardSignal = signal => child.kill(signal);
  process.once('SIGINT', forwardSignal); process.once('SIGTERM', forwardSignal);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
  } finally {
    process.removeListener('SIGINT', forwardSignal); process.removeListener('SIGTERM', forwardSignal);
  }
} catch (error) {
  console.error(`Local PostgreSQL setup failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
} finally {
  if (server) await server.close();
}
