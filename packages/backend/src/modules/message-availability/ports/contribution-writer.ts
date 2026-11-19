import type { ContributionChange } from '../domain/contribution.ts';
export interface ContributionWriter {
  apply(change: ContributionChange): Promise<'APPLIED' | 'IGNORED'>;
}
