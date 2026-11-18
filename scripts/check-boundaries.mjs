import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProject } from './architecture/check.mjs';
import { formatReport } from './architecture/report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const result = await checkProject(root);
  console[result.diagnostics.length ? 'error' : 'log'](formatReport(result));
  if (result.diagnostics.length) process.exitCode = 1;
} catch (error) {
  console.error(`Architecture checker could not inspect the project: ${error.message}`);
  process.exitCode = 1;
}
