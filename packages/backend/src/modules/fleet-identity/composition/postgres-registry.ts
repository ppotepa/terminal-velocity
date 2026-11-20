import type { SqlExecutor } from '../../../contracts/database/index.ts';
import { postgresIdentityReader } from '../infrastructure/postgres/postgres-identity-reader.ts';
import { reevaluatePositionOnConnection } from '../infrastructure/postgres/postgres-position-linker.ts';
import { expandReplayAliases } from '../infrastructure/postgres/expand-replay-aliases.ts';

export function createPostgresRegistryReader(sql: SqlExecutor) { return postgresIdentityReader(sql); }
export { reevaluatePositionOnConnection, expandReplayAliases };
