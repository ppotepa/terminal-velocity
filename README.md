# Terminal Velocity

Backend aplikacji łączącej mapę samolotów z ich komunikatami radiowymi. Projekt rozwijamy jako modularny monolit: małe moduły domenowe, SRP, jawne porty i kontrolowane zależności.

Repozytorium: [ppotepa/terminal-velocity](https://github.com/ppotepa/terminal-velocity). Dokumentacja wcześniejszego etapu projektowego używa nazwy roboczej Airframes Tracker; wewnętrzne pakiety zachowują przestrzeń nazw `@airframes`.

**Etap 1: lokalny demonstrator API.** Działa przyjmowanie syntetycznej wiadomości, korelacja z samolotem, wyznaczenie dostępności komunikatów i odczyt danych dla przyszłej mapy. Pozycje są fixture. Dane żyją w pamięci jednego procesu; restart je usuwa.

## Uruchomienie

Wymagany Node.js 24.x i npm. Z katalogu głównego:

```bash
npm ci
npm run check
npm start
```

API nasłuchuje na `http://127.0.0.1:3000`. Inny port ustaw przez zmienną `PORT`. Host jest celowo stały: demonstrator nie ma jeszcze produkcyjnego uwierzytelniania ani polityki publikacji.

W drugim terminalu uruchom przykład, który pobiera samolot z fixture, przyjmuje nowy komunikat i pokazuje wynik:

```bash
npm run example
```

Możesz też odpytać API:

```bash
curl http://127.0.0.1:3000/healthz
curl http://127.0.0.1:3000/api/v1/aircraft
```

## Działający przepływ

Żądanie HTTP przechodzi przez limit i parsowanie JSON, walidację faktów wiadomości, regułę korelacji i aktualizację wkładu dostępności. Zatwierdzenie stanu demo odbywa się w jednym procesie pod kolejką serializującą operacje. Ponowienie tego samego `messageId` z tymi samymi faktami zwraca wcześniejszy wynik. Inne fakty pod tym samym ID zwracają konflikt.

Świeżość liczymy od **czasu obserwacji**, także dla danych historycznych. Na odczycie aktualizujemy wygasłe statusy. `RECENT`, `STALE`, coverage i kondycja źródła są osobnymi informacjami; syntetyczny komunikat nie oznacza połączenia z prawdziwym odbiornikiem. Szczegóły kontraktu: [API.md](docs/API.md).

## Struktura

| Ścieżka | Odpowiedzialność |
|---|---|
| `packages/backend/src/kernel` | Małe typy wspólne, Result, czas |
| `packages/backend/src/contracts` | Typowane identyfikatory |
| `packages/backend/src/modules/aircraft-correlation` | Identyfikacja samolotu na podstawie dowodów temporalnych |
| `packages/backend/src/modules/message-availability` | Odwracalne wkłady, świeżość, wygasanie |
| `packages/backend/src/demo` | Złożenie scenariusza, syntetyczny katalog, pamięciowy stan i DTO |
| `apps/api/src` | Transport HTTP, routing, konfiguracja procesu i shutdown |
| `scripts/architecture` | Kontrola zależności przez AST TypeScript i testy naruszeń |
| `docs/architecture` | Uzgodniona architektura v2, katalog odpowiedzialności i projekty kontraktów |

Granulacja dotyczy odpowiedzialności kodu. Nie tworzymy osobnego procesu ani pakietu npm dla każdego pliku.

## Komendy

| Komenda | Zakres |
|---|---|
| `npm run check` | Typecheck strict, granice modułów i wszystkie testy |
| `npm run typecheck` | Rzeczywiste sprawdzenie TypeScript przez `tsc` |
| `npm run check:boundaries` | Statyczna kontrola zależności i cykli |
| `npm test` | Testy domen, scenariusza API i kontroli architektury |
| `npm run demo` | Referencyjny przykład korelacji, outboxu i korekty A→B |
| `npm start` | Serwer demonstracyjny na localhost |
| `npm run example` | Przykładowy klient działającego serwera |
| `npm run smoke` | Start rzeczywistego entrypointu, przykład klienta i zamknięcie procesu |

CI wykonuje te same bramki na GitHub Actions. Node usuwa typy podczas uruchomienia źródeł `.ts`; kontrolę typów wykonuje osobno `tsc`. Aplikacja nie wymaga zewnętrznych pakietów runtime.

## Status i dalszy rozwój

[IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) rozdziela wykonaną funkcjonalność od docelowej architektury. [ROADMAP.md](docs/ROADMAP.md) opisuje następne przekroje: PostgreSQL, jeden rzeczywisty konektor, pozycje/mapa, publication scope i aktualizacje przyrostowe.

Obecny etap nie zawiera rzeczywistych źródeł ADS-B/Airframes, pełnego dekodera RF, reassembly, bazy PostgreSQL, produkcyjnego outbox relay ani frontendu. Pliki SQL i JSON Schema w architekturze są projektami do dalszej implementacji. Udostępnienie demonstratora publicznie wymaga najpierw zbudowania warstwy dostępu i publikacji.
