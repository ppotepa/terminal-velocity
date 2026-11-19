import type { SqlPool } from '../../../../contracts/database/index.ts';
import { runSqlTransaction } from '../../../database-transactions/public/index.ts';
import type { DecisionTransaction, DecisionWriteSet } from '../../ports/decision-transaction.ts';
import { createPostgresDecisionWriteSet } from './create-postgres-decision-write-set.ts';
import { runDecisionWork } from './run-decision-work.ts';

export function createPostgresDecisionTransaction(pool: SqlPool): DecisionTransaction {
  return {
    async run<T>(work: (writes: DecisionWriteSet) => Promise<T>): Promise<T> {
      return runSqlTransaction(pool, sql => runDecisionWork(createPostgresDecisionWriteSet(sql), work));
    },
  };
}
