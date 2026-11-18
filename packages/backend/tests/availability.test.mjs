import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAge, freshnessPolicy, emptyAvailability, updateAvailability, expireAvailability,
  availabilityView, latestEligibleContribution } from '../src/modules/message-availability/public/index.ts';
import { A, B, M, M2, at, rev, assign, take } from './fixtures.mjs';
const policy = take(freshnessPolicy(600_000, 3_600_000));
const update = (state, change, now) => take(updateAvailability(state, change, at(now), policy));

test('freshness boundaries are unambiguous and require no new message', () => {
  assert.equal(classifyAge(at(1000), at(600_999), policy), 'RECENT');
  assert.equal(classifyAge(at(1000), at(601_000), policy), 'STALE');
  assert.equal(classifyAge(at(1000), at(3_600_999), policy), 'STALE');
  assert.equal(classifyAge(at(1000), at(3_601_000), policy), 'NONE');
});

test('an invalid policy is rejected', () => {
  for (const pair of [[0,100], [100,100], [-1,10], [50,20], [1.5,10]])
    assert.equal(freshnessPolicy(...pair).ok, false);
});

test('a delayed older message neither regresses latest nor extends its TTL', () => {
  let s = update(emptyAvailability(), assign(A,1_000_000), 1_001_000);
  s = update(s, assign(A,100,1,M2), 1_001_000);
  assert.equal(s.snapshots.get(A).lastEligibleMessageAt,1_000_000);
  assert.equal(s.snapshots.get(A).nextTransitionAt,1_600_000);
});

test('hour-old backfill alone does not produce a fresh green status', () => {
  const s = update(emptyAvailability(), assign(A,100), 3_600_100);
  assert.equal(s.snapshots.get(A).freshness,'NONE');
});

test('a future timestamp is rejected rather than stored as permanently fresh', () => {
  assert.equal(updateAvailability(emptyAvailability(), assign(A,200), at(100), policy).error.code,'FUTURE_OBSERVATION');
});

test('correcting assignment A→B removes the contribution from A and adds it to B', () => {
  let s = update(emptyAvailability(), assign(A,1000),1000);
  s = update(s,assign(B,1000,2),1000);
  assert.equal(s.snapshots.get(A).freshness,'NONE');
  assert.equal(s.snapshots.get(B).freshness,'RECENT');
});

test('retracting the latest message restores the previous eligible message', () => {
  let s = update(emptyAvailability(), assign(A,1000,1,M2),2000);
  s = update(s,assign(A,2000),2000);
  s = update(s,{type:'RETRACTED',messageId:M,revision:rev(2)},2000);
  assert.equal(s.snapshots.get(A).lastEligibleMessageAt,1000);
});

test('a tombstone blocks delayed revival of a retracted assignment', () => {
  let s = update(emptyAvailability(),assign(A,1000),1000);
  s = update(s,{type:'RETRACTED',messageId:M,revision:rev(2)},1000);
  const after = update(s,assign(A,1000,1),1000);
  assert.equal(after,s); assert.equal(after.snapshots.get(A).freshness,'NONE');
});

test('the same revision is idempotent; different content at that revision is an error', () => {
  const change = assign(A,1000); const s = update(emptyAvailability(),change,1000);
  assert.equal(update(s,change,1000),s);
  assert.equal(updateAvailability(s,assign(B,1000),at(1000),policy).error.code,'REVISION_COLLISION');
});

test('an old expectedRevision timer does not expire a newer message', () => {
  let s = update(emptyAvailability(),assign(A,1000),1000); const old = s.snapshots.get(A);
  s = update(s,assign(A,2000,1,M2),2000);
  const outcome = take(expireAvailability(s,{aircraftId:A,expectedRevision:old.revision,dueAt:old.nextTransitionAt},at(601_000),policy));
  assert.equal(outcome.outcome,'STALE_TIMER'); assert.equal(outcome.state,s);
});

test('a timer changes nothing before its deadline and transitions at the threshold', () => {
  const s = update(emptyAvailability(),assign(A,1000),1000); const snap = s.snapshots.get(A);
  const timer = {aircraftId:A,expectedRevision:snap.revision,dueAt:snap.nextTransitionAt};
  assert.equal(take(expireAvailability(s,timer,at(600_999),policy)).outcome,'NOT_DUE');
  const expired = take(expireAvailability(s,timer,at(601_000),policy));
  assert.equal(expired.outcome,'APPLIED'); assert.equal(expired.state.snapshots.get(A).freshness,'STALE');
});

test('a delayed scheduler transitions directly to NONE', () => {
  const s = update(emptyAvailability(),assign(A,1000),1000); const snap = s.snapshots.get(A);
  const outcome = take(expireAvailability(s,{aircraftId:A,expectedRevision:snap.revision,dueAt:snap.nextTransitionAt},at(3_601_000),policy));
  assert.equal(outcome.state.snapshots.get(A).freshness,'NONE');
  assert.equal(outcome.state.snapshots.get(A).nextTransitionAt,null);
});

test('revoking publication eligibility removes the public contribution', () => {
  let s = update(emptyAvailability(),assign(A,1000),1000);
  s = update(s,assign(A,1000,2,M,{publicEligible:false}),1000);
  assert.equal(s.snapshots.get(A).freshness,'NONE');
});

test('sampling or a source failure does not distort freshness', () => {
  const s = update(emptyAvailability(),assign(A,1000),1000);const snapshot = s.snapshots.get(A);
  const coverage = {kind:'SAMPLED',assessedAt:at(1000)};
  const sampled = availabilityView(snapshot,coverage,{state:'HEALTHY',assessedAt:at(1000)});
  const degraded = availabilityView(snapshot,coverage,{state:'DEGRADED',assessedAt:at(1000)});
  assert.equal(sampled.snapshot.freshness,'RECENT');assert.equal(degraded.snapshot.freshness,'RECENT');
  assert.deepEqual(sampled.coverage,degraded.coverage);
  assert.notEqual(sampled.feedHealth.state,degraded.feedHealth.state);
});

test('freshness for a specific bearer does not reuse another channel result', () => {
  let s = update(emptyAvailability(),assign(A,1000),2000);
  s = update(s,assign(A,2000,1,M2,{bearer:'HFDL'}),2000);
  assert.equal(latestEligibleContribution(s.ledger,A,at(2000),'VDL2'),1000);
  assert.equal(latestEligibleContribution(s.ledger,A,at(2000),'HFDL'),2000);
});


test('mutating the input object does not change a previously stored contribution', () => {
  const incoming = assign(A,1000);
  const s = update(emptyAvailability(),incoming,1000);
  incoming.contribution.observedAt = at(9000);
  incoming.contribution.aircraftId = B;
  incoming.revision = rev(99);
  assert.equal(s.ledger.get(M).contribution.observedAt,1000);
  assert.equal(s.ledger.get(M).contribution.aircraftId,A);
  assert.equal(s.ledger.get(M).revision,1);
  assert.equal(s.snapshots.get(A).lastEligibleMessageAt,1000);
});

test('deadline overflow after a new contribution returns an explicit Result error', () => {
  const latest = Number.MAX_SAFE_INTEGER;
  const outcome = updateAvailability(emptyAvailability(),assign(A,latest),at(latest),policy);
  assert.deepEqual(outcome,{ok:false,error:{code:'TIME_RANGE_OVERFLOW'}});
});

test('overflow of the next deadline during expiry does not mutate existing state', () => {
  const huge = take(freshnessPolicy(1,Number.MAX_SAFE_INTEGER));
  const s = take(updateAvailability(emptyAvailability(),assign(A,1),at(1),huge));
  const snap = s.snapshots.get(A);
  const outcome = expireAvailability(s,{aircraftId:A,expectedRevision:snap.revision,dueAt:snap.nextTransitionAt},at(2),huge);
  assert.deepEqual(outcome,{ok:false,error:{code:'TIME_RANGE_OVERFLOW'}});
  assert.equal(s.snapshots.get(A).freshness,'RECENT');
});
