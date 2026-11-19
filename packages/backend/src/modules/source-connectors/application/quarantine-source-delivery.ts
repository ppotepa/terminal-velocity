import type { ReplayCheckpoint, ReplayError } from '../ports/source-replay-checkpoint.ts';

export function quarantineSourceDelivery(checkpoint: ReplayCheckpoint, code: ReplayError): void {
  checkpoint.state = 'QUARANTINED';
  checkpoint.lastError = code;
  checkpoint.quarantined += 1;
  checkpoint.health.connectionState = code === 'RIGHTS_REVOKED' || code === 'UNAUTHORIZED' ? 'DISABLED' : 'DEGRADED';
}
