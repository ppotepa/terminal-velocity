import type { StrongIdentifier } from '../../modules/aircraft-correlation/public/index.ts';
import type { CanonicalMessage } from '../domain/canonical-message.ts';
export interface ParsedMessage {
  readonly canonical: CanonicalMessage;
  readonly identifiers: readonly StrongIdentifier[];
}
