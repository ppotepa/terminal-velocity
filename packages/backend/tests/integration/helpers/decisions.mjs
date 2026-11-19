import assert from 'node:assert/strict';
import { commitDecision } from '../../../src/modules/aircraft-correlation/public/index.ts';
import { createPostgresDecisionTransaction } from '../../../src/modules/aircraft-correlation/infrastructure/postgres/create-postgres-decision-transaction.ts';
import { uniqueId } from './database.mjs';

export const FIXED_TIME = Date.parse('2026-11-18T12:00:00.000Z');
export function makeDecision(messageId = uniqueId('msg'), aircraftId = null) {
  const base = { messageId, policyVersion: 'aircraft-identity/2', evaluations: [] };
  return aircraftId === null
    ? { ...base, status: 'UNMATCHED', reason: 'NO_STRONG_IDENTIFIERS' }
    : { ...base, status: 'MATCHED', aircraftId, basis: 'EXACT_ACTIVE_IDENTIFIER' };
}

export async function createDecisionEvent(pool, options = {}) {
  const decision = options.decision ?? makeDecision(options.messageId, options.aircraftId);
  const eventId = options.eventId ?? uniqueId('evt');
  const result = await commitDecision(decision, options.expectedRevision ?? null,
    'integration-directory/1', options.decidedAt ?? FIXED_TIME,
    createPostgresDecisionTransaction(pool), { next: () => eventId });
  assert.equal(result.ok, true, JSON.stringify(result));
  return { eventId, type: 'correlation.aircraft-decision-revised.v1', payload: result.value };
}
