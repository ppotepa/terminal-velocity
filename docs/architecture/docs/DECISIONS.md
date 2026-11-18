# Decyzje architektoniczne v2

Wszystkie decyzje poniżej mają status **proponowane dla implementacji**. Implementacja referencyjna potwierdza wybrane reguły; nie jest ukończonym monorepo aplikacji.

## ADR-201 — Granulacja wewnątrz kontekstu

**Kontekst:** v1 używał jednego pojęcia mikro-domeny dla reguł biznesowych, projekcji i mechanizmów transportu.

**Decyzja:** osiem właścicieli modeli biznesowych; integracje, odczyt, delivery i platforma osobno. Małe moduły SRP wewnątrz tych granic. Katalog odpowiedzialności jest mapą projektu, nie listą osobnych deployów.

**Konsekwencje:** możliwy duży podział kodu przy zachowaniu lokalnych transakcji; mniej ukrytych zależności. Wydzielenie usługi dotyczy właściciela danych, nie pojedynczej funkcji.

## ADR-202 — Fakty komunikacji oddzielone od interpretacji

**Decyzja:** SourceDelivery, Reception, FrameOccurrence, AssemblySession i MessageRevision są różnymi pojęciami. Import gotowej wiadomości nie tworzy sztucznej ramki/stacji.

**Konsekwencje:** więcej precyzyjnych modeli, ale możliwość reprocess/redecode bez zmieniania faktów. Deduplikacja nie usuwa pochodzenia.

## ADR-203 — Dwa etapy korelacji

**Decyzja:** Message→Aircraft i Message→FlightSession mają osobne modele, porty i polityki. Aircraft można potwierdzić bez session.

**Konsekwencje:** panel rozróżnia wiadomości maszyny od wiadomości przypisanych do konkretnego odcinka lotu. Brak sesji nie jest błędem identyfikacji samolotu. Callsign sam nie potwierdza fizycznej maszyny.

## ADR-204 — Wersjonowane, odwracalne decyzje

**Decyzja:** link i publikowany wkład mają historię i rewizje. Wyższa pełna rewizja zastępuje lokalnie zapamiętany stan; retrakcja zostawia tombstone.

**Konsekwencje:** korekta A→B aktualizuje oba końce, a `max(lastSeen)` przestaje być jedyną pamięcią. Koszt przechowywania wkładów jest świadomie większy niż jednej daty.

## ADR-205 — Cztery osie dostępności

**Decyzja:** freshness, match outcome, coverage i feed health są niezależne. Publiczny status liczy się tylko z dozwolonych wkładów. Pozycja ma własną świeżość.

**Konsekwencje:** brak jednej etykiety „częściowe” o wielu znaczeniach. UI potrafi wyjaśnić brak ramek bez stwierdzenia, że samolot nie nadaje.

## ADR-206 — Port commit z atomowością i konkurencją

**Decyzja:** use case otrzymuje wąski capability set do zapisu lokalnej decyzji i outbox. Adapter musi gwarantować serializację/CAS per klucz także dla pierwszego INSERT.

**Konsekwencje:** domena nie zna SQL, ale port mówi więcej niż „save”. Test double ma ograniczony zakres; implementacja DB musi przejść osobne testy konkurencji i awarii.

## ADR-207 — Trwała dostawa od pierwszego wdrożenia

**Decyzja:** outbox + trwałe deliveries/inbox w PostgreSQL jako wariant początkowy, albo od razu outbox + trwały broker. Zwykły EventEmitter nie potwierdza wykonania wszystkich odbiorców.

**Konsekwencje:** retry, lease, quarantine i niezależne consumer IDs są częścią projektu, nie przypadkowym dodatkiem po pierwszym incydencie. Nie potrzeba pełnego event sourcingu; stan domenowy i historia ważnych decyzji wystarczają.

## ADR-208 — Snapshot i delta z tej samej projekcji

**Decyzja:** model odczytu ma generation i porządek zmian; snapshot posiada checkpoint w tym porządku. Gateway najpierw zabezpiecza replay/buffering, potem zwraca snapshot.

**Konsekwencje:** REST i WS nie działają jako dwie niezależne prawdy. Kontrakt obsługuje remove, restart, zmianę filtrów i wygasły cursor.

## ADR-209 — Abstrakcje przez kompozycję

**Decyzja:** generyki dla stabilnych mechanizmów technicznych; konkretne nazwy dla reguł lotniczych. Ręczny composition root; brak globalnego kontenera zależności w domenie.

**Konsekwencje:** małe funkcje są naturalną jednostką SRP. Klasy powstają tam, gdzie jest stan i lifecycle. Dodawanie nowego adaptera nie wymaga dziedziczenia po uniwersalnym BaseService.

## ADR-210 — Wdrożenie etapowe i jawny stan gotowości

**Decyzja:** implementacja zaczyna się od jednego kompletnego przepływu na dwóch źródłach danych. Nie generujemy dziesiątek pustych serwisów z metodami TODO tylko po to, by drzewo wyglądało na pełne.

**Konsekwencje:** katalog docelowy może być rozbudowany, lecz każdy dostarczony fragment kodu ma uruchamialne zachowanie i opis ograniczeń. Produkcja wymaga adapterów, praw do danych, testów trwałości i pomiarów.
