import test from 'node:test';
import assert from 'node:assert/strict';
import { aircraftId, messageId, revision } from '../src/contracts/identity/index.ts';
import { icao24, registration, decideAircraftMatch } from '../src/modules/aircraft-correlation/public/index.ts';
import { epochMillis } from '../src/kernel/time/epoch-millis.ts';
import { A, B, candidate, input, icao, reg } from './fixtures.mjs';

test('fabryki sprawdzają domenowe ID i rewizje', () => {
  assert.equal(aircraftId('msg_wrong').ok, false);
  assert.equal(messageId('ac_wrong').ok, false);
  assert.equal(revision(0).ok, false);
  assert.equal(revision(1.5).ok, false);
  assert.equal(icao24('48c2b4').value, '48C2B4');
  assert.equal(icao24('48c2bZZ').ok, false);
  assert.equal(registration(' sp-lvd ').value, 'SP-LVD');
  assert.equal(registration('<script>').ok, false);
});

test('ICAO24 wskazuje jedną maszynę bez konieczności istnienia sesji lotu', () => {
  const found = decideAircraftMatch(input([icao('48C2B4')]), [candidate(A, [icao('48C2B4')])]);
  assert.equal(found.status, 'MATCHED'); assert.equal(found.aircraftId, A);
  assert.equal('flightId' in found, false); assert.equal('confidence' in found, false);
});

test('sam callsign nie potwierdza tożsamości', () => {
  const result = decideAircraftMatch({ ...input([]), callsign: 'LOT123' }, [candidate(A, [icao('48C2B4')])]);
  assert.equal(result.status, 'UNMATCHED'); assert.equal(result.reason, 'NO_STRONG_IDENTIFIERS');
});

test('brak kandydata jest UNMATCHED', () => {
  assert.equal(decideAircraftMatch(input([icao('48C2B4')]), []).status, 'UNMATCHED');
});

test('dwie maszyny z tym samym aktywnym aliasem są AMBIGUOUS niezależnie od kolejności', () => {
  const candidates = [candidate(A, [icao('48C2B4')]), candidate(B, [icao('48C2B4')])];
  const a = decideAircraftMatch(input([icao('48C2B4')]), candidates);
  const b = decideAircraftMatch(input([icao('48C2B4')]), [...candidates].reverse());
  assert.equal(a.status, 'AMBIGUOUS'); assert.deepEqual(a, b);
});

test('sprzeczna rejestracja stanowi veto, mimo dokładnego ICAO24', () => {
  const result = decideAircraftMatch(input([icao('48C2B4'), reg('SP-AAA')]), [candidate(A, [icao('48C2B4'), reg('SP-BBB')])]);
  assert.equal(result.status, 'CONFLICTED'); assert.equal('aircraftId' in result, false);
});

test('rozłączne silne przesłanki dają konflikt również przy niekompletnych aliasach', () => {
  const result = decideAircraftMatch(input([icao('48C2B4'), reg('SP-BBB')]),
    [candidate(A, [icao('48C2B4')]), candidate(B, [reg('SP-BBB')])]);
  assert.equal(result.status, 'CONFLICTED');
});

test('druga zgodna przesłanka rozstrzyga niejednoznaczność ICAO24', () => {
  const result = decideAircraftMatch(input([icao('48C2B4'), reg('SP-AAA')]),
    [candidate(A, [icao('48C2B4'), reg('SP-AAA')]), candidate(B, [icao('48C2B4')])]);
  assert.equal(result.status, 'MATCHED'); assert.equal(result.aircraftId, A);
});

test('aliasy są czasowe: validUntil nie należy do starego przedziału', () => {
  const candidates = [candidate(A, [reg('SP-AAA')], 0, 100), candidate(B, [reg('SP-AAA')], 100, null)];
  assert.equal(decideAircraftMatch(input([reg('SP-AAA')], 99), candidates).aircraftId, A);
  assert.equal(decideAircraftMatch(input([reg('SP-AAA')], 100), candidates).aircraftId, B);
});

test('expired alias nie tworzy dopasowania przy przetwarzaniu obecnych danych', () => {
  assert.equal(decideAircraftMatch(input([icao('48C2B4')], 100), [candidate(A, [icao('48C2B4')], 0, 100)]).status, 'UNMATCHED');
});


test('niepoprawne czasy nie przechodzą konstruktora', () => {
  for (const value of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(epochMillis(value).ok, false);
});

test('alias nie działa przed validFrom ani przy odwróconym przedziale', () => {
  assert.equal(decideAircraftMatch(input([reg('SP-AAA')],99),[candidate(A,[reg('SP-AAA')],100,null)]).status,'UNMATCHED');
  assert.equal(decideAircraftMatch(input([reg('SP-AAA')],100),[candidate(A,[reg('SP-AAA')],100,50)]).status,'UNMATCHED');
});


test('powtórzony AircraftId nie omija veto przez drugi uboższy rekord', () => {
  const conflicting = candidate(A,[icao('48C2B4'),reg('SP-BBB')]);
  const incomplete = candidate(A,[icao('48C2B4')]);
  for (const candidates of [[conflicting,incomplete],[incomplete,conflicting]]) {
    const outcome = decideAircraftMatch(input([icao('48C2B4'),reg('SP-AAA')]),candidates);
    assert.equal(outcome.status,'CONFLICTED');
    assert.equal(outcome.reason,'DUPLICATE_CANDIDATE');
    assert.equal('aircraftId' in outcome,false);
  }
});

test('różne aktywne aliasy tego samego rodzaju są konfliktem nawet przy jednej zgodnej wartości', () => {
  for (const identifiers of [[icao('48C2B4'),icao('48C2B5')],[reg('SP-AAA'),reg('SP-BBB')]]) {
    const outcome = decideAircraftMatch(input([identifiers[0]]),[candidate(A,identifiers)]);
    assert.equal(outcome.status,'CONFLICTED');
    assert.equal(outcome.reason,'CONFLICTING_ACTIVE_ALIASES');
  }
});

test('powielony dowód tego samego aktywnego aliasu nie tworzy konfliktu', () => {
  const outcome = decideAircraftMatch(input([icao('48C2B4')]),[candidate(A,[icao('48C2B4'),icao('48C2B4')])]);
  assert.equal(outcome.status,'MATCHED');
});

test('dwa różne aliasy w rozłącznych okresach nie tworzą konfliktu katalogu', () => {
  const old = candidate(A,[reg('SP-AAA')],0,100);
  const current = candidate(A,[reg('SP-BBB')],100,null);
  const aircraft = {aircraftId:A,aliases:[...old.aliases,...current.aliases]};
  assert.equal(decideAircraftMatch(input([reg('SP-AAA')],99),[aircraft]).status,'MATCHED');
  assert.equal(decideAircraftMatch(input([reg('SP-BBB')],100),[aircraft]).status,'MATCHED');
});
