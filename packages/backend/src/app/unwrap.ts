import type { Result } from '../kernel/result.ts';
/** Tylko bootstrap/demo. W obsłudze żądań błąd jest mapowany na jawny kontrakt. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`Invalid demo fixture: ${JSON.stringify(result.error)}`);
  return result.value;
}
