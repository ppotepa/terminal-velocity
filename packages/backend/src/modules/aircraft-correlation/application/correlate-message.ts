import { err } from '../../../kernel/result.ts';
import type { Revision } from '../../../contracts/identity/index.ts';
import type { Clock } from '../../../kernel/time/clock.ts';
import type { CorrelationInput } from '../domain/correlation-input.ts';
import { decideAircraftMatch } from '../domain/decide-aircraft-match.ts';
import type { CandidateDirectory } from '../ports/candidate-directory.ts';
import type { DecisionTransaction } from '../ports/decision-transaction.ts';
import type { EventIdGenerator } from '../ports/event-id-generator.ts';
import { commitDecision } from './commit-decision.ts';
export interface CorrelationDependencies {
  readonly directory: CandidateDirectory;
  readonly transaction: DecisionTransaction;
  readonly clock: Clock;
  readonly eventIds: EventIdGenerator;
}
export function createCorrelateMessage(dependencies: CorrelationDependencies) {
  return async (input: CorrelationInput, expectedRevision: Revision | null) => {
    // The catalog read is versioned; a catalog change triggers a separate replay.
    const snapshot = await dependencies.directory.find(input);
    if (snapshot.completeness !== 'COMPLETE')
      return err({ code: 'CANDIDATE_SET_INCOMPLETE' as const, reason: snapshot.reason });
    const decision = decideAircraftMatch(input, snapshot.candidates);
    return commitDecision(decision, expectedRevision, snapshot.revision, dependencies.clock.now(),
      dependencies.transaction, dependencies.eventIds);
  };
}
