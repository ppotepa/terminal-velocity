# Kontrakty między modułami i interfejsem

Kontrakty poniżej są propozycją docelową. `reference/` implementuje wewnętrzne typy wybranych reguł, nie całą serializację sieciową. Przykładowy JSON Schema trzech rodzin eventów jest w `../contracts/state-events.schema.json`.

## 1. Zdarzenie to zatwierdzony fakt

| Rodzina zdarzeń | Producent | Konsumenci | Powód publikacji |
|---|---|---|---|
| `communications.reception.accepted.v1` | communications | receiver health, decode processing | Zachowano nowy potwierdzony odbiór |
| `communications.message.revised.v1` | communications | correlation, publication | Powstała nowa interpretacja / kompletna wiadomość |
| `fleet.identity.revised.v1` | fleet-identity | indeks korelacji, reprocess planner | Zmieniło się ważne powiązanie identyfikatora |
| `tracking.session.revised.v1` | flight-tracking | flight-link correlation | Zmieniła się sesja lotu lub jej granice |
| `correlation.aircraft-link.revised.v1` | correlation | publication, audyt | Rozstrzygnięto lub skorygowano powiązanie maszyny |
| `correlation.flight-link.revised.v1` | correlation | publication, odczyt sesji | Osobno rozstrzygnięto sesję lotu |
| `publication.message-contribution.replaced.v1` | publication | availability, message timeline | Pełny nowy stan dozwolonego wkładu w danym scope |
| `availability.aircraft.changed.v1` | availability | map projection, powiadomienia zakresu | Zmienił się wynik statusu dla maszyny |
| `map.projection.changed.v1` | read-model writer | delivery | Powstała wersjonowana delta widoku |

Nie publikujemy osobnego trwałego eventu tylko dlatego, że wykonano `normalizeString`, `computeHash` albo jedną regułę porównania. Są to lokalne kroki i funkcje. Event wychodzi po znaczącej granicy commit.

## 2. Koperta i rewizje

Koperta przykładu ma eventId, type, schemaVersion, stream key/revision, occurredAt, recordedAt, causationId, traceId i typowany payload.

| Pole | Gwarancja |
|---|---|
| `eventId` | Stabilne przy retry tego samego faktu; inne dla nowej rewizji |
| `schemaVersion` | Wersja struktury wire, niezależna od wersji algorytmu |
| `stream.key` | Zakres porządku, np. message albo `(scope,message)` |
| `stream.revision` | Monotoniczna rewizja tylko wewnątrz tego streamu |
| `occurredAt` | Czas decyzji/faktu domenowego, niekoniecznie czas transmisji RF |
| `recordedAt` | Czas zapisu do outboxu |
| `causationId` | Przyczyna, jeśli była innym zdarzeniem |
| `traceId` | Diagnostyka; nie identyfikuje biznesowo danych |

`observedAt` dla świeżości znajduje się w payloadzie wkładu. Nie podstawiamy za niego occurredAt/recordedAt. Eventy w tych przykładach mają pełny replacement state. Historia `previous` służy audytowi; projector wycofuje stan faktycznie zapisany lokalnie.

### Dodatkowe niezmienniki poza JSON Schema

- stream key jest wyprowadzony z właściwego klucza domenowego, a nie dowolną etykietą;
- `contributionRevision == stream.revision` w rodzinie publikowanego wkładu;
- eventId istniejące wcześniej nie może dostać innego payloadu;
- wyższa rewizja może zastąpić starszą tylko dla tego samego klucza;
- `RECENT` wymaga istniejącego, dozwolonego i dostatecznie świeżego wkładu;
- daty i progi są zgodne z właściwą freshnessPolicyVersion;
- UUID/string z JSON musi przejść fabrykę domenowego ID;
- odbiorca ma uprawnienie do danego visibilityScope;
- grant i assignment są wejściem do osobnej contributionRevision, nie wspólną skalą liczb.

JSON Schema odrzuca niepoprawną strukturę. Nie wykonuje autoryzacji ani nie dowodzi, że aircraftId rzeczywiście istnieje.

## 3. Błędy wymagają różnych reakcji

| Wynik | Znaczenie | Reakcja |
|---|---|---|
| `UNMATCHED` | Poprawnie wykonano reguły, dowodów nie wystarczyło | Zachować fakt; reprocess przy nowej wiedzy |
| `AMBIGUOUS` | Więcej niż jeden kandydat | Nie wybierać losowo; pokazać/utrwalić przyczynę |
| `CONFLICTED` | Mocne dowody albo katalog są sprzeczne | Zatrzymać auto-match, zachować evidence |
| `CANDIDATE_SET_INCOMPLETE` | Indeks lub zapytanie nie dostarczyło pełnych danych | Retry/backfill; brak nowej decyzji domenowej |
| `VERSION_CONFLICT` | Ktoś zatwierdził nowszą zmianę | Odczyt nowszego stanu i świadoma ponowna ocena |
| `INVALID_INPUT` | Niepoprawny kontrakt albo wartość | Odrzucenie/quarantine; brak retry bez poprawy |
| `TEMPORARY_SOURCE_FAILURE` | Niedostępny provider/budget | Kontrolowane retry z terminem |
| `ACCESS_REVOKED` | Zakres nie jest już dostępny | Blokada/revoke, unieważnienie starego resume |

## 4. REST: osobno maszyna i lot

```http
GET /api/v1/map/aircraft?bbox=...&bearer=VDL2&freshness=RECENT
GET /api/v1/aircraft/:aircraftId
GET /api/v1/aircraft/:aircraftId/messages?cursor=...&limit=50
GET /api/v1/flight-sessions/:flightSessionId
GET /api/v1/flight-sessions/:flightSessionId/messages?cursor=...
GET /api/v1/flight-sessions/:flightSessionId/observed-track
GET /api/v1/messages/:messageId
GET /api/v1/messages/:messageId/association-explanation
GET /api/v1/stations
POST /api/v1/feeder/deliveries
```

Panel otwarty z samolotu domyślnie pokazuje wiadomości maszyny. Przełączenie na konkretną sesję zawęża wynik; brak sessionId nie usuwa prawidłowo powiązanych wiadomości z widoku samolotu.

`messages` zwraca `dataLevel` i dozwolone reprezentacje (`summary`, `decoded`, `raw available`, `withheld`). Endpoint nie deklaruje raw frame, jeśli źródło go nie dostarczyło. Cursor historii jest związany z filtrem, zakresem uprawnień i stabilnym kluczem sortowania `(observedAt,messageId,revision)`. Korekty historii obsługujemy przez rewizje/re-fetch; nie obiecujemy niezmiennego snapshotu wielodniowej paginacji bez jawnego snapshot tokena.

Upload feedera używa eventId/source epoch i weryfikowanego tokenu. ACK przyjęcia znaczy „trwale przyjęto delivery”, a nie „ramka poprawnie zdekodowana i już opublikowana”. Stan przetwarzania jest osobnym kontraktem.

## 5. WebSocket

Żądanie subskrypcji:

```json
{
  "type": "subscribe.viewport",
  "requestId": "req-17",
  "bbox": [14.0, 49.0, 24.5, 55.0],
  "filters": { "bearers": ["VDL2"], "freshness": ["RECENT", "STALE"] },
  "resumeToken": null
}
```

Snapshot jest opatrzony subscriptionId, generation i opaque cursor. Dla dużej mapy może być chunkowany; klient stosuje go jako całość dopiero po `snapshot.end`.

```json
{
  "type": "delta.batch",
  "subscriptionId": "sub-17",
  "generation": "view-generation-2",
  "fromCursor": "opaque-cursor-a",
  "toCursor": "opaque-cursor-b",
  "changes": [
    { "kind": "remove", "aircraftId": "aircraft-A", "reason": "OUTSIDE_VIEWPORT" }
  ]
}
```

Delta pozycji nie może samodzielnie kasować metadanych ramek. Preferujemy wyraźny pełny `AircraftMapView` dla upsert albo wersjonowane fragmenty z jawnie niezależnymi rewizjami. Pusty/null payload nie ma wielu ukrytych znaczeń.

Każdy cursor odpowiada konkretnemu scope i zestawowi filtrów. Serwer nie ufa scope wskazanemu przez klienta; wyznacza go z uprawnień. Po zmianie uprawnień token jest nieważny nawet wtedy, gdy jego zakres czasu mieści się w retencji logu.

## 6. Zmiana wersji

Wprowadzamy nowy event schema w trybie expand/contract: konsumenci obsługują starą i nową wersję w okresie migracji, producent przełącza się kontrolowanie, a stara obsługa znika po wygaśnięciu horyzontu replay. Jeśli upcaster nie może odtworzyć brakującego znaczenia, event trafia do jawnej ścieżki migracji; nie tworzy zmyślonych danych.

Zmiana policyVersion może wymagać reprocess bez zmiany JSON schema. Zmiana projekcji uruchamia nową generation, budowę od zera i cutover po checkpoint. To trzy różne procesy i osobne odpowiedzialności.
