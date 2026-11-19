export function readSafeInteger(value: unknown, minimum: number, name: string): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[0-9]+$/.test(value)))
    throw new TypeError(`The stored ${name} is not an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum)
    throw new RangeError(`The stored ${name} is outside the supported integer range.`);
  return parsed;
}
