import type { Result } from '../kernel/result.ts';
/** Bootstrap/demo only. Request handlers map errors to an explicit contract. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`Invalid demo fixture: ${JSON.stringify(result.error)}`);
  return result.value;
}
