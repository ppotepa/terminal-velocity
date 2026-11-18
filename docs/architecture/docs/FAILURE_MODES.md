# Niezmienniki i scenariusze awarii

**Rozróżnienie:** ten plik opisuje wymagane sprawdzenia całej przyszłej aplikacji. Testy faktycznie wykonane w tej iteracji są wymienione w `../VERIFICATION.md` i w `../reference/VERIFICATION.md`.

| Obszar | Scenariusz | Oczekiwany wynik | Gdzie weryfikować |
|---|---|---|---|
| Dostawy | Ponowienie eventu po reconnect | Jeden efekt dostawy | Contract + DB |
| Dostawy | To samo ID, inny payload | Konflikt i zachowanie dowodu | Contract + DB |
| Odbiór | Ta sama transmisja odebrana przez 3 stacje | 3 odbiory, jedna hipoteza frame occurrence | Domain + DB |
| Deduplikacja | Identyczny tekst w odrębnych chwilach | Nie scalać bez dowodu protokołu | Domain |
| Deduplikacja | Dwa odbiory po obu stronach granicy bucketa | Kandydaci wyszukani w sąsiednich przedziałach | Domain + DB |
| Deduplikacja | Równoległy get-or-create wystąpienia | Jeden poprawny wynik albo jawny konflikt/retry | DB z 2 procesami |
| Reassembly | Fragmenty 3,1,2 | Złożenie tylko dla polityki dopuszczającej out-of-order | Decoder contract |
| Reassembly | Różna treść tego samego sequence | Konflikt, nie ciche nadpisanie | Domain |
| Reassembly | Brak ostatniego fragmentu | Wygaszenie sesji, stan niekompletny | Domain + worker |
| Wejście | Dostawca daje tylko message summary | Brak fikcyjnej ramki i stacji | Contract |
| Protokół | VDL2 bez ACARS | Poprawny stos protokołu | Decoder contract |
| Tożsamość | Silny ID i brak flight session | Aircraft rozpoznany, flight nadal nieznany | Reference + integration |
| Tożsamość | Zmiana właściciela aliasu w czasie | Historyczny czas wybiera historyczne powiązanie | Reference |
| Tożsamość | Dwa aktywne różne aliasy tego samego kind | Jawny konflikt katalogu zgodnie z polityką | Reference |
| Tożsamość | Dwukrotnie ten sam AircraftId w snapshot | Odmowa niespójnego zbioru, bez ominięcia veto | Reference |
| Korelacja | Callsign bez mocnych dowodów | Brak fałszywego MATCHED | Reference |
| Korelacja | Dwóch równorzędnych kandydatów | AMBIGUOUS | Reference |
| Korelacja | Częściowo pobrany katalog | Retry/INCOMPLETE, nie UNMATCHED | Reference |
| Korelacja | Wersja katalogu zmienia się podczas operacji | Zapamiętana użyta rewizja, zaplanowane ponowne przeliczenie | Integration |
| Availability | Rewizje 1,3,2,3 | Stan z 3; starsza i duplikat bez skutków | Reference |
| Availability | Ta sama rewizja, inna treść | REVISION_COLLISION | Reference |
| Availability | Przypisanie A→B | Przeliczone oba samoloty | Reference |
| Availability | Wycofanie najnowszej wiadomości | Wybór poprzedniej kwalifikującej się | Reference |
| Availability | Stare przypisanie po retrakcji | Tombstone nie pozwala odtworzyć wkładu | Reference |
| Availability | Caller mutuje przyjęty obiekt | Przyjęty ledger nie zmienia się przez alias wejścia | Reference |
| Czas | Dokładnie 10 minut | STALE | Reference |
| Czas | Dokładnie 60 minut | NONE | Reference |
| Czas | Nowa wiadomość przed wykonaniem starego timera | Stary job nie zmienia nowej rewizji | Reference |
| Czas | Restart workera po 2 godzinach | Bezpośrednio poprawny status na teraz | Reference + worker |
| Czas | Backfill starej wiadomości | Nie odświeża statusu według ingestion time | Reference |
| Czas | Timestamp spoza zaufanego zakresu | Odmowa/quality state, bez nowej zielonej kropki | Boundary + domain |
| Feed | Sampled feed nadal connected | Coverage sampled, health healthy | Reference + connector |
| Feed | Brak połączenia | Osobny health, bez zmiany historycznego czasu | Reference + connector |
| Publikacja | Prywatna wiadomość | Nie zmienia publicznej treści, licznika ani statusu | Reference częściowo + E2E |
| Publikacja | Odebranie grantu po wysłaniu snapshotu | Gate blokuje replay, remove/resync dla klienta | E2E |
| Publikacja | Ta sama treść z publicznego i prywatnego źródła | Nie ujawnia prywatnych odbiorów/stacji | Integration |
| Rewizje | assignment r7, grant r3 | Własny contributionRevision; brak porównania różnych liczników | Contract |
| Transakcje | Błąd przy append outbox | Rollback decyzji i eventu | Reference + DB |
| Transakcje | Dwa zapisy expectedRevision N | Jeden sukces; drugi conflict/retry | Reference + DB wieloprocesowe |
| Transakcje | Równoległy pierwszy INSERT | Unikalność/CAS także dla nieistniejącego head | DB |
| Dostarczanie | Crash po commit, przed ACK | Brak drugiego efektu | DB + broker/worker |
| Dostarczanie | Jeden event i dwóch consumers | Oba efekty niezależnie | DB |
| Dostarczanie | Niższy ID zatwierdzony po wyższym | Dispatcher niczego nie pomija | DB |
| Dostarczanie | Wygasły lease, inny worker przejął pracę | Stary token nie zatwierdza nowej pracy | DB |
| Projekcje | Replay z nową polityką | Nowa generation; kontrolowane przełączenie | Integration |
| WS | Zdarzenie między snapshotem i startem live | Dostarczone przez replay po checkpoint | Integration/E2E |
| WS | Zmiana bbox/filter w locie | Stara generation ignorowana | Client reducer + E2E |
| WS | Samolot opuszcza bbox | remove, bez ducha na mapie | E2E |
| WS | Retencja cursor wygasła | resync.required | Integration/E2E |
| WS | Powolny klient | Ograniczony buffer; coalescing pozycji lub resync | Load |
| Architektura | Domain importuje app/infrastructure | Gate odrzuca import | Architecture check |
| Architektura | Dwie domeny importują swoje wnętrza | Gate odrzuca deep import i cykl | Architecture check |

## Metryki, które mają sens

- `source_ingest_lag_seconds`: osobno dla źródła i jakości timestampu;
- `correlation_decisions_total{status,reason,policy}`: konflikt/ambiguity nie są ukrywane w sukcesie;
- `correlation_candidate_incomplete_total`: brak gotowego indeksu a nie fałszywe UNMATCHED;
- `assignment_retractions_total` i `availability_repairs_total`;
- `outbox_oldest_unrouted_seconds`, `delivery_lag_seconds{consumer}`, `delivery_attempts`;
- `expiry_overdue_seconds`: opóźnienie zmiany statusu bez nowych wiadomości;
- `projection_checkpoint_age_seconds` i `ws_resync_total{reason}`;
- `publication_revocation_lag_seconds`: czas usunięcia widoku po cofnięciu grantu.

Nie etykietujemy metryk każdym messageId lub aircraftId: to grozi niekontrolowaną kardynalnością. Takie szczegóły należą do ograniczonych logów/tracingu z prawidłową polityką treści.
