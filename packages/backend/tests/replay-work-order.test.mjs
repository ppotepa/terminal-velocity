import test from 'node:test';
import assert from 'node:assert/strict';
import { replayWorkOrder, replayWorkSuccessor } from '../src/modules/source-connectors/domain/replay-work-order.ts';

test('each queue is scheduled once per three completed turns when all are nonempty', () => {
  let turn = 'JOBS';
  const observed = [];
  for (let i = 0; i < 12; i++) {
    const chosen = replayWorkOrder(turn)[0];
    observed.push(chosen);
    turn = replayWorkSuccessor(chosen);
  }
  assert.deepEqual(observed, ['JOBS', 'EXPANSIONS', 'CORRECTIONS',
    'JOBS', 'EXPANSIONS', 'CORRECTIONS', 'JOBS', 'EXPANSIONS', 'CORRECTIONS',
    'JOBS', 'EXPANSIONS', 'CORRECTIONS']);
});

test('empty classes are skipped and the next turn begins after actual work', () => {
  let turn = 'JOBS';
  const offered = new Set(['EXPANSIONS', 'CORRECTIONS']);
  const observed = [];
  for (let i = 0; i < 6; i++) {
    const chosen = replayWorkOrder(turn).find(kind => offered.has(kind));
    observed.push(chosen);
    turn = replayWorkSuccessor(chosen);
  }
  assert.deepEqual(observed, ['EXPANSIONS', 'CORRECTIONS', 'EXPANSIONS',
    'CORRECTIONS', 'EXPANSIONS', 'CORRECTIONS']);
});

test('unknown persisted scheduler state fails instead of dropping queued work', () => {
  assert.throws(() => replayWorkOrder('UNSUPPORTED'), /Unrecognized/);
});
