import type { Brand } from '../../../kernel/brand.ts';
import { err, ok, type Result } from '../../../kernel/result.ts';

export type SourceId = Brand<string, 'SourceId'>;
export type InvalidSourceId = { readonly code: 'INVALID_SOURCE_ID' };

/** Parses a stable, application-assigned source configuration identifier. */
export function sourceId(input: unknown): Result<SourceId, InvalidSourceId> {
  return typeof input === 'string' && /^src_[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/u.test(input)
    ? ok(input as SourceId)
    : err({ code: 'INVALID_SOURCE_ID' });
}
