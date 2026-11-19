import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createTestDatabase } from './test-database.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
let database;
try {
  database = await createTestDatabase(process.env.TEST_DATABASE_URL);
  const directories = ['packages/backend/tests/integration', 'apps/api/tests/integration'];
  const tests = [];
  for (const directory of directories) {
    const names = await readdir(new URL(`../../${directory}/`, import.meta.url)).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    tests.push(...names.filter(name => name.endsWith('.test.mjs')).sort().map(name => `${directory}/${name}`));
  }
  if (!tests.length) throw new Error('No PostgreSQL integration tests were found.');
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...tests], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, TEST_DATABASE_URL: database.adminUrl,
      TEST_RUNTIME_DATABASE_URL: database.runtimeUrl, TV_TEST_DATABASE_NAME: database.name },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
} catch (error) {
  console.error(`PostgreSQL integration setup failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
} finally {
  if (database) await database.close();
}
