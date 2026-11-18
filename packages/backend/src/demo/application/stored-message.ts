import type { MatchDecision } from '../../modules/aircraft-correlation/public/index.ts';
import type { CanonicalMessage } from '../domain/canonical-message.ts';
export interface StoredMessage { readonly canonical: CanonicalMessage; readonly decision: MatchDecision; }
