import { acquire } from './airframes-live.mjs';

try {
  const result = await acquire(...process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'API_UNAVAILABLE' || result.status === 'PARTIAL_LAYOUT') process.exitCode = 2;
} catch (error) {
  console.error('Message acquisition failed:', error.message);
  process.exitCode = 1;
}
