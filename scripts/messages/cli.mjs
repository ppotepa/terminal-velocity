import { acquire } from './airframes-live.mjs';

const controller = new AbortController();
const stop = () => controller.abort();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  const [strategy, address] = process.argv.slice(2);
  const result = await acquire(strategy, address, controller.signal);
  console.log(JSON.stringify(result));
  if (!['COMPLETE', 'OBSERVED', 'NO_CONFIRMED_MATCH', 'NO_OBSERVATIONS_COVERAGE_UNKNOWN'].includes(result.status)) process.exitCode = ['API_UNAVAILABLE', 'RIGHTS_BLOCKED', 'PARTIAL_LAYOUT', 'TRUNCATED'].includes(result.status) ? 2 : 1;
} catch {
  console.error('Message acquisition failed. Usage: npm run messages -- dry-run <ICAO24> | crawl <ICAO24> | api');
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
