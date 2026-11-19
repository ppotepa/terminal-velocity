import { aircraftId, messageId, revision } from '../../../contracts/identity/index.ts';
import { epochMillis } from '../../../kernel/time/epoch-millis.ts';
import type { ContributionChange } from '../domain/contribution.ts';

/** All nullable fields represent the public projection, including a tombstone. */
export interface ContributionRow {
  readonly messageId: string;
  readonly revision: number;
  readonly aircraftId: string | null;
  readonly observedAt: number | null;
  readonly bearer: string | null;
}

export function snapshotContribution(change: ContributionChange): ContributionRow {
  const currentRevision = change.revision;
  if (!revision(currentRevision).ok) throw new TypeError('The contribution revision is invalid.');
  if (change.type === 'RETRACTED') {
    const id = change.messageId;
    if (typeof id !== 'string' || !messageId(id).ok) throw new TypeError('The contribution message ID is invalid.');
    return Object.freeze({ messageId: id, revision: currentRevision, aircraftId: null, observedAt: null, bearer: null });
  }
  if (change.type !== 'ASSIGNED') throw new TypeError('The contribution change type is invalid.');
  const contribution = change.contribution;
  const id = contribution.messageId;
  const aircraft = contribution.aircraftId;
  const observedAt = contribution.observedAt;
  const bearer = contribution.bearer;
  const publicEligible = contribution.publicEligible;
  if (typeof id !== 'string' || !messageId(id).ok || typeof aircraft !== 'string' || !aircraftId(aircraft).ok)
    throw new TypeError('A contribution identifier is invalid.');
  if (!epochMillis(observedAt).ok) throw new TypeError('The contribution observation time is invalid.');
  if (!['VHF_ACARS', 'VDL2', 'HFDL', 'SATCOM'].includes(bearer) || typeof publicEligible !== 'boolean')
    throw new TypeError('The contribution eligibility or bearer is invalid.');
  return Object.freeze({ messageId: id, revision: currentRevision,
    aircraftId: publicEligible ? aircraft : null,
    observedAt: publicEligible ? observedAt : null,
    bearer: publicEligible ? bearer : null });
}
