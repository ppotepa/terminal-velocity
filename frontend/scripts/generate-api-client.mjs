import { spawnSync } from 'node:child_process';

const result = spawnSync('openapi-typescript', ['../contracts/openapi.yaml', '--output', 'src/shared/api/generated.ts'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
