/** PostgreSQL bigint is read as text; never silently round it into a JS number. */
export function postgresInteger(input: unknown): number {
  if (typeof input !== 'string' || !/^(0|[1-9][0-9]*)$/.test(input))
    throw new Error('Invalid PostgreSQL integer representation.');
  const value = Number(input);
  if (!Number.isSafeInteger(value)) throw new Error('PostgreSQL integer exceeds the supported safe range.');
  return value;
}
