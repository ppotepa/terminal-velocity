import type { Result } from '../../../kernel/result.ts';
import { parseSourceObservation, type SourceObservation, type SourceParseError } from '../domain/source-observation.ts';

/** Narrow parser port: adapters accept untrusted provider input and return a typed failure. */
export interface SourceParser<TRaw, TCanonical, TFailure> {
  parse(raw: TRaw): Result<TCanonical, TFailure>;
}

/** Validates an already normalized envelope; it does not claim to parse any provider format. */
export const sourceObservationContractParser: SourceParser<unknown, SourceObservation, SourceParseError> =
  Object.freeze({ parse: parseSourceObservation });
