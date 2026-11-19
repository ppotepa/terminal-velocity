import type { Result } from '../../../../kernel/result.ts';

export function invalidDecision(field: string): never {
  throw new Error(`Invalid stored decision data: ${field}.`);
}

export function recordValue(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return invalidDecision('object');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)))
    return invalidDecision('object fields');
  return value;
}

export function stringValue(input: unknown): string {
  return typeof input === 'string' ? input : invalidDecision('string');
}

export function booleanValue(input: unknown): boolean {
  return typeof input === 'boolean' ? input : invalidDecision('boolean');
}

export function arrayValue(input: unknown): readonly unknown[] {
  return Array.isArray(input) ? input : invalidDecision('array');
}

export function oneOf<const T extends string>(input: unknown, values: readonly T[]): T {
  for (const value of values) if (input === value) return value;
  return invalidDecision('literal');
}

export function checkedValue<T, E>(result: Result<T, E>): T {
  return result.ok ? result.value : invalidDecision('validated value');
}

export function numberValue(input: unknown): number {
  return typeof input === 'number' ? input : invalidDecision('number');
}
