import type { MessageId } from '../../contracts/identity/index.ts';
import type { EpochMillis } from '../../kernel/time/epoch-millis.ts';
import type { DemoBearer } from './bearer.ts';
export interface CanonicalMessage {
  readonly messageId: MessageId;
  readonly observedAt: EpochMillis;
  readonly observedAtIso: string;
  readonly bearer: DemoBearer;
  readonly text: string;
  readonly icao24: string | null;
  readonly registration: string | null;
  readonly callsign: string | null;
}
