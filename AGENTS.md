# Terminal Velocity — zasady implementacji

## Cel i zakres

Śledzenie pozycji samolotów i powiązanych komunikatów radiowych. Aktualny etap to lokalny backend demonstracyjny. Wszystkie fixture są syntetyczne; podłączenie rzeczywistych źródeł wymaga osobnego adaptera i jawnej polityki publikacji.

## Granice odpowiedzialności

- Stosuj SRP: jeden powód zmiany na moduł, małe przypadki użycia i czyste reguły. Liczba plików nie jest celem samym w sobie.
- `packages/backend/src/modules/*/domain` nie zależy od HTTP, Node, bazy ani composition root.
- Łącz domeny przez ich `public/index.ts`; nie importuj prywatnych warstw sąsiedniego modułu.
- `apps/api` zna wyłącznie publiczny interfejs backendu. Transport nie rozstrzyga korelacji ani świeżości.
- `src/demo` składa istniejące domeny, fixture i pamięciowe adaptery. Nie udawaj w nim trwałego przetwarzania, prawdziwego feedu ani produkcyjnej polityki dostępu.
- Generyczne mechanizmy wprowadzaj dla rzeczywistego wspólnego kontraktu; nie twórz BaseService, GenericRepository ani service locatora.
- Zawsze odróżniaj czas obserwacji od czasu przyjęcia. Backfill nie staje się świeży po ponownym imporcie.
- Niepełna lista kandydatów, sprzeczne identyfikatory i nierozstrzygnięte dopasowania nie mogą tworzyć potwierdzonego statusu.
- Widoczność danych musi obejmować również liczniki i statusy. Nie wyprowadzaj publicznej kropki z prywatnego komunikatu.
- Zachowuj idempotencję, tombstone i odwracalność wkładów. Rewizje różnych agregatów nie są zamienne.

## Sprawdzenia

Uruchom z katalogu głównego `npm ci` oraz `npm run check`. Istotna zmiana w przepływie uruchamiania wymaga także sprawdzenia startu i zamknięcia procesu API. Dołącz testy zachowań i regresji dla zmienionych niezmienników, nie testy kopiujące implementację.

Nowe zależności muszą mieć konkretny cel. Zachowuj lockfile. Nie dodawaj sekretów, danych prawdziwych odbiorników ani produkcyjnych komunikatów do fixture.

## Zmiany i dokumentacja

Pracuj na gałęzi tematycznej. Opis PR: problem, zmiana zachowania, sprawdzenia i faktyczne ograniczenia. Aktualizuj `docs/IMPLEMENTATION_STATUS.md` wraz z zakresem implementacji. Dokumenty w `docs/architecture/` opisują docelową architekturę; nie są dowodem wykonania wszystkich elementów.
