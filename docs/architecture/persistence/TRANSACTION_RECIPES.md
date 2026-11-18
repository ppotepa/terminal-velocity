# Kontrakty transakcji do adapterów PostgreSQL

To projekt zachowania adaptera, nie przetestowana migracja. `REFERENCE_DDL.sql` zawiera wybrane tabele. Test double w `reference/` udowadnia wyłącznie opisane zachowania w pamięci jednego procesu.

## 1. CommitCorrelationRevision

Wejście: messageId, expectedRevision, pełna nowa decyzja, messageRevision, candidateIndexRevision, policyVersion, eventId.

1. Rozpocznij transakcję.
2. Zserializuj konkurujące zmiany dla messageId. Wariant A: CAS `UPDATE ... WHERE revision = expected` i sprawdzenie liczby zmienionych wierszy. Wariant B: blokada poprawnie utworzonego head row lub transakcyjna blokada klucza. Sam `SELECT FOR UPDATE` nie zablokuje nieistniejącego wiersza przy pierwszym insercie.
3. Jeżeli expectedRevision nie odpowiada bieżącej, zwróć konflikt bez zmiany stanu/outboxu.
4. Zapisz niezmienną rewizję decyzji, ustaw current head i append outbox w tej samej transakcji.
5. Commit. Dopiero po tym zgłoś sukces.

Pierwszy zapis używa unikalności messageId i obsługuje konkurencyjny INSERT jako konflikt/retry. Commit nie może uznać błędu unikalności za pomyślny zapis bez sprawdzenia, co faktycznie zostało zatwierdzone. Wariant izolacji SERIALIZABLE także wymaga obsługi retry.

## 2. ConsumeOnce

Klucz `(consumerId,eventId)`, a nie samo eventId. Payload digest wykrywa sprzeczne ponowienie tego samego ID.

1. BEGIN.
2. `INSERT consumer_inbox ... ON CONFLICT DO NOTHING RETURNING ...`.
3. Jeśli brak inserta, porównaj digest. Zgodny → idempotentny sukces, różny → konflikt/quarantine, bez nowego efektu.
4. Jeżeli nowy rekord, zastosuj efekt we własnych tabelach i dopisz nowe eventy outbox.
5. COMMIT, a następnie ACK albo oznaczenie delivery DONE.

Crash przed commit wycofuje inbox i efekt. Crash po commit, przed ACK powoduje powtórną dostawę rozpoznawaną przez inbox. Nie zatrzymujemy częściowego efektu po przechwyceniu błędu.

## 3. Trwały fan-out przed wprowadzeniem brokera

Dispatcher znajduje **wszystkie** outboxy bez `fanout_completed_at`, nie tylko rekordy o ID większym od zapamiętanego maksimum. Przydzielenie ID nie jest kolejnością commit.

Krótka transakcja claimuje paczkę, pobiera ustaloną wersję rejestru subskrybentów, tworzy deliveries z unikalnością `(consumerId,eventId)` i oznacza wykonany fan-out. Nowy konsument ma oddzielny kontrolowany backfill; nie oczekujemy automatycznego odtworzenia historii przez stary znacznik fan-out.

Delivery worker nadaje leaseToken i leaseUntil, wykonuje pracę, a wynik zatwierdza tylko przy zgodnym tokenie. Reaper oddaje wygasłe lease do READY. Stara instancja workera nie może potwierdzić pracy już przejętej przez inną.

Kolejność per stream: delta eventy czekają na oczekiwaną rewizję, replacement eventy mogą zastąpić wcześniejszą. Gap nie jest bezwarunkowo ignorowany. Backoff i quarantine mają osobne kontrakty; nie rośnie nieograniczona pętla retry.

## 4. ReplaceContribution

Autorytatywny producent `publication` łączy stan przypisania i uprawnienia w **jedną rosnącą rewizję wkładu**. Nie wolno porównywać max(assignmentRevision,policyRevision), bo to różne osie.

1. BEGIN i lock wkładu `(scope,messageId)`; obsługa pierwszego INSERT jak wyżej.
2. Wersja mniejsza → no-op; równa i zgodny digest → no-op; równa i inny digest → błąd.
3. Odczytaj poprzedni wkład z bazy. Nie ufaj, że event.previous odpowiada lokalnie zastosowanej wersji.
4. Ustal zbiór staryAircraftId/nowyAircraftId i zablokuj ich rekordy w deterministycznej kolejności.
5. Zastąp wkład albo wpisz tombstone.
6. Dla obu maszyn wybierz ostatni aktywny, dozwolony wkład; wylicz freshness i następny termin.
7. Zapisz nową rewizję stanu, expiry job i outbox.
8. COMMIT.

Wydzielenie stanu dwóch maszyn do oddzielnych shardów wymaga dodatkowego modelu konwergencji; tej gwarancji nie przenosi się automatycznie przez sieć.

## 5. Wygaśnięcie

Job zawiera scope, aircraftId, expectedRevision, dueAt. Transakcja odczytuje stan i weryfikuje obie wartości. Gdy wiadomość zdążyła się zmienić, job kończy się jako stale/no-op. Gdy czas jeszcze nie nadszedł, nie wykonuje przejścia. Po długim postoju liczy stan na aktualny czas, może ominąć pośredni kolor.

Odczyt API może dodatkowo obliczyć freshness z lastObservedAt i serverNow, ale nie zastąpi to aktualizacji indeksów/filtrów mapy. Potrzebne są timer i naprawa zaległych stanów.

## 6. Spójny snapshot projekcji

Writer mapy utrzymuje w jednym commit: zmienione wiersze mapy, blokowany licznik stream_heads i change_log dla tej rewizji. Dzięki serializacji licznika nie publikujemy checkpointu, za którym kryje się niezatwierdzona niższa rewizja.

Reader w REPEATABLE READ odczytuje checkpoint C i wiersze mapy z tego samego widoku. Gateway już buforuje live, a log umożliwia replay po C. Do budowy snapshotu nie używa SKIP LOCKED. Powrót klienta z nieznanym generation lub wygasłym cursorem oznacza nowy snapshot.

## 7. Testy integracyjne wymagane przed wdrożeniem

- Dwa procesy commitujące ten sam expectedRevision: dokładnie jeden sukces.
- Dwa pierwsze INSERT-y bez wcześniejszego head row: jeden zwycięzca, brak dwóch rewizji 1.
- Awaria outbox INSERT cofa zapis domeny.
- Powtórna konsumpcja po utracie ACK nie zwiększa liczników.
- Dwa różne consumerId przetwarzają ten sam event.
- ID outboxu przydzielone wcześniej, commit później: dispatcher go nie pomija.
- Przeterminowany lease nie może oznaczyć cudzej pracy jako DONE.
- Transfer A→B i równoległe wygaśnięcie nie zostawiają nieprawidłowego stanu.
- Snapshot i delta przy równoległym writerze obejmują każdą zmianę dokładnie semantycznie raz (z dozwoloną deduplikacją dostaw).
