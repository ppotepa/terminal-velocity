import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAge, freshnessPolicy, emptyAvailability, updateAvailability, expireAvailability,
  availabilityView, latestEligibleContribution } from '../src/modules/message-availability/public/index.ts';
import { A, B, M, M2, at, rev, assign, take } from './fixtures.mjs';
const policy = take(freshnessPolicy(600_000, 3_600_000));
const update = (state, change, now) => take(updateAvailability(state, change, at(now), policy));

test('granice świeżości są jednoznaczne i nie wymagają nowego komunikatu', () => {
  assert.equal(classifyAge(at(1000), at(600_999), policy), 'RECENT');
  assert.equal(classifyAge(at(1000), at(601_000), policy), 'STALE');
  assert.equal(classifyAge(at(1000), at(3_600_999), policy), 'STALE');
  assert.equal(classifyAge(at(1000), at(3_601_000), policy), 'NONE');
});

test('niepoprawna polityka jest odrzucona', () => {
  for (const pair of [[0,100], [100,100], [-1,10], [50,20], [1.5,10]])
    assert.equal(freshnessPolicy(...pair).ok, false);
});

test('spóźniona starsza wiadomość nie cofa latest i nie wydłuża jego TTL', () => {
  let s = update(emptyAvailability(), assign(A,1_000_000), 1_001_000);
  s = update(s, assign(A,100,1,M2), 1_001_000);
  assert.equal(s.snapshots.get(A).lastEligibleMessageAt,1_000_000);
  assert.equal(s.snapshots.get(A).nextTransitionAt,1_600_000);
});

test('sam backfill sprzed godziny nie daje świeżego zielonego statusu', () => {
  const s = update(emptyAvailability(), assign(A,100), 3_600_100);
  assert.equal(s.snapshots.get(A).freshness,'NONE');
});

test('czas z przyszłości jest odrzucony, a nie zapisany jako wiecznie świeży', () => {
  assert.equal(updateAvailability(emptyAvailability(), assign(A,200), at(100), policy).error.code,'FUTURE_OBSERVATION');
});

test('korekta przypisania A→B wycofuje wkład z A i dodaje go do B', () => {
  let s = update(emptyAvailability(), assign(A,1000),1000);
  s = update(s,assign(B,1000,2),1000);
  assert.equal(s.snapshots.get(A).freshness,'NONE');
  assert.equal(s.snapshots.get(B).freshness,'RECENT');
});

test('wycofanie najnowszej wiadomości przywraca poprzednią właściwą', () => {
  let s = update(emptyAvailability(), assign(A,1000,1,M2),2000);
  s = update(s,assign(A,2000),2000);
  s = update(s,{type:'RETRACTED',messageId:M,revision:rev(2)},2000);
  assert.equal(s.snapshots.get(A).lastEligibleMessageAt,1000);
});

test('tombstone blokuje spóźnione wskrzeszenie cofniętego powiązania', () => {
  let s = update(emptyAvailability(),assign(A,1000),1000);
  s = update(s,{type:'RETRACTED',messageId:M,revision:rev(2)},1000);
  const after = update(s,assign(A,1000,1),1000);
  assert.equal(after,s); assert.equal(after.snapshots.get(A).freshness,'NONE');
});

test('ta sama rewizja jest idempotentna, inna treść pod nią jest błędem', () => {
  const change = assign(A,1000); const s = update(emptyAvailability(),change,1000);
  assert.equal(update(s,change,1000),s);
  assert.equal(updateAvailability(s,assign(B,1000),at(1000),policy).error.code,'REVISION_COLLISION');
});

test('stary timer expectedRevision nie gasi nowej wiadomości', () => {
  let s = update(emptyAvailability(),assign(A,1000),1000); const old = s.snapshots.get(A);
  s = update(s,assign(A,2000,1,M2),2000);
  const outcome = take(expireAvailability(s,{aircraftId:A,expectedRevision:old.revision,dueAt:old.nextTransitionAt},at(601_000),policy));
  assert.equal(outcome.outcome,'STALE_TIMER'); assert.equal(outcome.state,s);
});

test('timer przed terminem nic nie zmienia, a na progu przełącza stan', () => {
  const s = update(emptyAvailability(),assign(A,1000),1000); const snap = s.snapshots.get(A);
  const timer = {aircraftId:A,expectedRevision:snap.revision,dueAt:snap.nextTransitionAt};
  assert.equal(take(expireAvailability(s,timer,at(600_999),policy)).outcome,'NOT_DUE');
  const expired = take(expireAvailability(s,timer,at(601_000),policy));
  assert.equal(expired.outcome,'APPLIED'); assert.equal(expired.state.snapshots.get(A).freshness,'STALE');
});

test('opóźniony scheduler przechodzi bezpośrednio do NONE', () => {
  const s = update(emptyAvailability(),assign(A,1000),1000); const snap = s.snapshots.get(A);
  const outcome = take(expireAvailability(s,{aircraftId:A,expectedRevision:snap.revision,dueAt:snap.nextTransitionAt},at(3_601_000),policy));
  assert.equal(outcome.state.snapshots.get(A).freshness,'NONE');
  assert.equal(outcome.state.snapshots.get(A).nextTransitionAt,null);
});

test('cofnięcie publikowalności usuwa publiczny wkład', () => {
  let s = update(emptyAvailability(),assign(A,1000),1000);
  s = update(s,assign(A,1000,2,M,{publicEligible:false}),1000);
  assert.equal(s.snapshots.get(A).freshness,'NONE');
});

test('źródło próbkowane/awaria nie fałszuje freshness', () => {
  const s = update(emptyAvailability(),assign(A,1000),1000);const snapshot = s.snapshots.get(A);
  const coverage = {kind:'SAMPLED',assessedAt:at(1000)};
  const sampled = availabilityView(snapshot,coverage,{state:'HEALTHY',assessedAt:at(1000)});
  const degraded = availabilityView(snapshot,coverage,{state:'DEGRADED',assessedAt:at(1000)});
  assert.equal(sampled.snapshot.freshness,'RECENT');assert.equal(degraded.snapshot.freshness,'RECENT');
  assert.deepEqual(sampled.coverage,degraded.coverage);
  assert.notEqual(sampled.feedHealth.state,degraded.feedHealth.state);
});

test('odczyt świeżości dla konkretnego bearer nie pożycza wyniku innego kanału', () => {
  let s = update(emptyAvailability(),assign(A,1000),2000);
  s = update(s,assign(A,2000,1,M2,{bearer:'HFDL'}),2000);
  assert.equal(latestEligibleContribution(s.ledger,A,at(2000),'VDL2'),1000);
  assert.equal(latestEligibleContribution(s.ledger,A,at(2000),'HFDL'),2000);
});


test('mutacja wejściowego obiektu nie zmienia wcześniej zapisanego wkładu', () => {
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

test('overflow terminu po nowym wkładzie jest jawnym Result error', () => {
  const latest = Number.MAX_SAFE_INTEGER;
  const outcome = updateAvailability(emptyAvailability(),assign(A,latest),at(latest),policy);
  assert.deepEqual(outcome,{ok:false,error:{code:'TIME_RANGE_OVERFLOW'}});
});

test('overflow kolejnego terminu przy wygaśnięciu nie mutuje istniejącego stanu', () => {
  const huge = take(freshnessPolicy(1,Number.MAX_SAFE_INTEGER));
  const s = take(updateAvailability(emptyAvailability(),assign(A,1),at(1),huge));
  const snap = s.snapshots.get(A);
  const outcome = expireAvailability(s,{aircraftId:A,expectedRevision:snap.revision,dueAt:snap.nextTransitionAt},at(2),huge);
  assert.deepEqual(outcome,{ok:false,error:{code:'TIME_RANGE_OVERFLOW'}});
  assert.equal(s.snapshots.get(A).freshness,'RECENT');
});
