/** Accept the driver's bigint text without allowing a lossy numeric conversion. */
export function readPostgresInteger(value: unknown, minimum: number): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)))
    throw new TypeError('The stored availability integer is invalid.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum)
    throw new RangeError('The stored availability integer is outside the supported range.');
  return parsed;
}
