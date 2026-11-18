# Dokumentacja docelowej architektury v2

Dokumenty w tym katalogu zachowują decyzje z etapu projektowania. Wzmianki o `reference/` dotyczą poprzedniej paczki; jej działający rdzeń został przeniesiony do `packages/backend`. Liczby testów i ograniczenia narzędzi opisane w historycznej v2 należy odczytywać jako stan tamtej iteracji.

**Aktualny zakres implementacji:** [IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md). **Działające API:** [API.md](../API.md).

- [Architektura i uzasadnienia](ARCHITECTURE_V2.md)
- [Katalog odpowiedzialności](docs/MODULE_CATALOG.md)
- [Decyzje architektoniczne](docs/DECISIONS.md)
- [Docelowe zdarzenia i API](docs/EVENTS_AND_API.md)
- [Scenariusze awarii](docs/FAILURE_MODES.md)
- [Projekt DDL](persistence/REFERENCE_DDL.sql)
- [Przepisy transakcyjne](persistence/TRANSACTION_RECIPES.md)

Projekt DDL nie jest migracją uruchamianą przez aplikację. Schemat zdarzeń w `contracts/` opisuje planowane kontrakty, a nie bieżące REST DTO demonstratora.
