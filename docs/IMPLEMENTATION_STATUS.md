# Terminal Velocity — stan implementacji, etap 1

Data: 18 listopada 2026. Wersja kodu: `0.1.0`. Cel tego etapu: uruchamialny backend i jeden spójny przepływ przez domenę, przygotowane do dalszego rozwijania na GitHubie.

## Wykonane

| Obszar | Implementacja |
|---|---|
| Repozytorium | npm workspaces, Node.js 24.x, lockfile, instrukcje i workflow GitHub Actions |
| Korelacja | Silne identyfikatory temporalne, conflict veto, ambiguity i kontrola kompletności katalogu |
| Dostępność | Odwracalne wkłady, korekta A→B w rdzeniu, tombstone, progi 10/60 min, expiry z rewizją |
| Scenariusz demo | Trzy syntetyczne samoloty, walidacja, idempotentny ingest, jeden zatwierdzany stan pod mutexem |
| API | Sześć endpointów, limity wejścia, jawne statusy błędów, DTO, loopback i graceful shutdown |
| Granice | Analizator AST importów i eksportów, publiczne wejścia modułów, brak cykli |
| Obsługa projektu | README, API guide, roadmap, zasady pracy i przykład klienta |

Kod źródłowy obejmuje **98 plików TypeScript** w workspace'ach. Dodatkowe pliki `.mjs` implementują checker, testy i skrypty. Podział wynika z odpowiedzialności parsera, reguł, przypadku użycia, adaptera, kontraktu i composition root.

## Sprawdzenia lokalne

| Sprawdzenie | Wynik |
|---|---|
| `tsc --noEmit` obu workspace'ów | PASS, ustawienia strict |
| Granice architektury | PASS, 98 plików / 321 zależności AST |
| Regresje checkera AST | 28/28 PASS |
| Testy backendu | 62/62 PASS — 41 rdzenia i 21 scenariusza demo |
| Testy HTTP/config/shutdown | 25/25 PASS |
| Łącznie testy | **115/115 PASS** |
| Przykład rdzenia | PASS: korelacja, testowy outbox, wygasanie i korekta A→B |
| Uruchomienie rzeczywistego entrypointu | PASS: health, klient POST/replay, RECENT i zamknięcie SIGTERM |

Wyniki dotyczą lokalnego runtime Node.js 24.22.3. Workflow CI jest zapisany; wykonanie na GitHubie należy potwierdzić na konkretnym commicie po przesłaniu repozytorium. Brak uruchomienia workflow nie może być opisany jako zielony CI.

## Granice gwarancji

API demo wykonuje staging i jeden swap `DemoState` pod mutexem. To atomowość w jednym procesie, bez trwałości i bez wieloprocesowej izolacji. Po restarcie znika stan i historia idempotencji. Maksymalnie 500 wiadomości ogranicza pamięciowy zbiór.

Wcześniejszy port transakcji decyzja + outbox wraz z adapterem memory nadal ma testy w rdzeniu. **Nie jest produkcyjnym outboxem podłączonym do ścieżki HTTP demo.** Adapter PostgreSQL, relay, inbox i potwierdzenia dostarczenia pozostają do wdrożenia.

Status demo jest przeliczany na odczycie; proces nie uruchamia trwałego schedulera. Klient nie może ustalać uprawnień publikacji. `publicEligible: true` w wewnętrznym wkładzie dotyczy wyłącznie syntetycznego scope demonstracyjnego i nie jest gotową polityką dostępu.

Dane pozycji są nieruchomymi fixture; nie ma rzeczywistego śledzenia lotu. API pokazuje brak realnego feedu jako `DISCONNECTED`. Wiadomości demo są zdekodowanymi przykładami tekstowymi, nie przechwyconymi ramkami RF. Nie ma jeszcze mapy frontendowej, sesji lotu, reassembly ani integracji z Airframes/ADSB.

Architektura v2 jest zachowana w `docs/architecture`. Jej katalog 89 odpowiedzialności opisuje kierunek rozwoju, nie liczbę gotowych usług. Następny etap opisuje [ROADMAP.md](ROADMAP.md).
