# API demonstratora — v0.1

Adres lokalny: `http://127.0.0.1:3000`. W tym etapie nie ma uwierzytelniania. Serwer wiąże się wyłącznie z interfejsem loopback, a wszystkie identyfikatory samolotów i pozycje pochodzą z fixture.

## Odczyt

| Metoda i ścieżka | Wynik |
|---|---|
| `GET /healthz` | Żywotność procesu, tryb demo i pamięciowy storage |
| `GET /api/v1/aircraft` | Lista syntetycznych samolotów z pozycją i dostępnością komunikatów |
| `GET /api/v1/aircraft/:id` | Szczegóły jednego samolotu i aktualna dostępność |
| `GET /api/v1/aircraft/:id/messages` | Komunikaty dopasowane do wskazanego samolotu |
| `GET /api/v1/messages/:id` | Pojedyncza wiadomość i bezpieczny DTO rozstrzygnięcia |

Odczyty danych korzystają z koperty `{ "data": ... }`. Brak obiektu to HTTP 404. Lista bez wiadomości jest poprawnym wynikiem z pustą tablicą. Dane pozycji nie symulują ruchu; `position.observedAt` jest stałym czasem zapisanym w fixture.

## Przyjęcie wiadomości

`POST /api/v1/demo/messages`, `Content-Type: application/json`.

Przykład kształtu żądania; rzeczywisty przykład używający aktualnego czasu i identyfikatora fixture uruchamia `npm run example`:

```json
{
  "messageId": "msg_example-1",
  "observedAt": "2026-11-18T12:00:00.000Z",
  "bearer": "VDL2",
  "text": "Syntetyczna wiadomość demonstracyjna",
  "icao24": "D00001"
}
```

Wymagane pola: `messageId`, `observedAt`, `bearer`, `text`. Opcjonalne identyfikatory: `icao24`, `registration`, `callsign`. Brak mocnego identyfikatora nie jest dowodem dopasowania. Callsign samodzielnie nie potwierdza samolotu. Bearer: `VHF_ACARS`, `VDL2`, `HFDL`, `SATCOM`.

Klient nie określa kandydatów, `publicEligible`, rewizji uprawnień ani visibility scope. Nieznane pola są odrzucane. `messageId` ma prefiks `msg_`, po którym następuje 1–64 liter ASCII, cyfr lub znaków `-`. Czas obserwacji musi być poprawnym znacznikiem UTC; przyszłe obserwacje są odrzucane.

Nowy komunikat daje HTTP **201**; identyczne ponowienie daje **200** z `created: false`. Treść odpowiedzi:

```json
{
  "data": {
    "created": true,
    "message": {
      "messageId": "msg_example-1",
      "observedAt": "2026-11-18T12:00:00.000Z",
      "bearer": "VDL2",
      "text": "Syntetyczna wiadomość demonstracyjna",
      "correlation": {
        "outcome": "MATCHED",
        "aircraftId": "ac_demo-001"
      }
    }
  }
}
```

Powyższy przykład używa pierwszego syntetycznego samolotu. Rezultat jest jednym z `MATCHED`, `UNMATCHED`, `AMBIGUOUS`, `CONFLICTED`. Tylko `MATCHED` wskazuje `aircraftId`; pozostałe rezultaty mają `null`. Nierozstrzygnięta wiadomość pozostaje dostępna przez własne ID i nie daje zielonego statusu samolotowi.

Zmiana faktów istniejącej wiadomości daje **409 MESSAGE_CONFLICT**. Jawna korekta z historią będzie odrębnym przypadkiem użycia. Idempotencja w tym etapie trwa do restartu procesu.

Demo przechowuje maksymalnie **500 wiadomości**. Pole `text` ma limit **4096 jednostek kodowych UTF-16**. Te ograniczenia chronią niewielki pamięciowy zbiór; nie zastępują projektowanej retencji w trwałym magazynie.

## Dostępność komunikatów

`availability.freshness` jest wyliczana według wieku ostatniego kwalifikującego się komunikatu:

| Wiek obserwacji | Status |
|---|---|
| `0 ≤ wiek < 10 min` | `RECENT` |
| `10 min ≤ wiek < 60 min` | `STALE` |
| `wiek ≥ 60 min` lub brak wkładu | `NONE` |

Backfill korzysta z czasu `observedAt`, nie z chwili POST. `lastMessageAt` może pozostać ustawione dla historycznej wiadomości mimo `NONE`. Coverage w demonstratorze to `UNKNOWN`, a zdrowie realnego feedu to `DISCONNECTED`; nie uruchamiamy rzeczywistej transmisji.

## Błędy

Koperta: `{ "error": { "code": "...", "message": "..." } }`.

| HTTP | Znaczenie |
|---|---|
| 400 | Niepoprawny JSON, kształt, ID, czas lub nieobsługiwane parametry |
| 404 | Nieznana ścieżka lub nieistniejący obiekt |
| 405 | Nieobsługiwana metoda dla istniejącej ścieżki |
| 409 | Inne fakty pod istniejącym ID wiadomości |
| 413 | Przekroczony limit 16 KiB ciała żądania |
| 415 | Nieobsługiwany Content-Type |
| 429 | Osiągnięty limit pamięciowej kolekcji demonstratora |
| 500 | Błąd wewnętrzny, bez ujawniania stack trace |
| 503 | Niepełne dane kandydatów, jeśli adapter zwróci taki błąd |

Nie ma paginacji ani filtrów przestrzennych w API v0.1. Ich kontrakt powstanie wraz z trwałym modelem odczytu; nie akceptujemy nieobsługiwanych parametrów w sposób pozornie skuteczny.
