import type { ContributionChange } from './contribution.ts';
export function sameChange(left: ContributionChange, right: ContributionChange): boolean {
  if (left.type !== right.type || left.revision !== right.revision) return false;
  if (left.type === 'RETRACTED' && right.type === 'RETRACTED') return left.messageId === right.messageId;
  if (left.type === 'ASSIGNED' && right.type === 'ASSIGNED') {
    const a = left.contribution, b = right.contribution;
    return a.messageId === b.messageId && a.aircraftId === b.aircraftId &&
      a.observedAt === b.observedAt && a.bearer === b.bearer && a.publicEligible === b.publicEligible;
  }
  return false;
}
