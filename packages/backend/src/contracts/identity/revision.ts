import type { Brand } from '../../kernel/brand.ts';
import { err, ok, type Result } from '../../kernel/result.ts';
export type Revision = Brand<number, 'Revision'>;
export function revision(input: number): Result<Revision, { readonly code: 'INVALID_REVISION' }> {
  return Number.isSafeInteger(input) && input >= 1
    ? ok(input as Revision) : err({ code: 'INVALID_REVISION' });
}
export function nextRevision(previous: Revision | null): Revision {
  const result = revision(previous === null ? 1 : previous + 1);
  if (!result.ok) throw new RangeError('Revision overflow');
  return result.value;
}
