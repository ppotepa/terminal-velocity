# Kontrola granic architektury

Uruchomienie z katalogu głównego, po `npm ci`:

```sh
npm run check:boundaries
node --test scripts/architecture/*.test.mjs
```

Checker używa parsera AST TypeScript. Obejmuje pliki TS/JS w `src` jawnie wymienionych workspace'ów. Rozpoznaje importy statyczne, importy tylko typów, re-eksporty, wyrażenia `import("...").Type`, dynamiczne importy z literałem, `import = require`, literalne `require` oraz referencje triple-slash. Komentarze i napisy zawierające pozorny import nie tworzą zależności. Dynamiczna nazwa modułu jest błędem: nie można potwierdzić jej granic statycznie.

| Plik | Jedyna główna odpowiedzialność |
| --- | --- |
| `project.mjs` | Odkrycie workspace'ów, plików źródłowych i ich właścicieli. |
| `parse.mjs` | Odczyt krawędzi zależności z AST. |
| `resolve.mjs` | Rozwiązanie ścieżki i publicznego eksportu pakietu. |
| `policy.mjs` | Jawne dozwolone kierunki zależności. |
| `check.mjs` | Orkiestracja analizy i wykrywanie cykli, również typów. |
| `report.mjs` | Format czytelnych diagnostyk z plikiem i pozycją. |
| `check-boundaries.test.mjs` | Regresje naruszeń i poprawnych wyjątków. |

Kernel zależy wyłącznie od kernela. Kontrakty zależą od kernela i kontraktów. Domena modułu zależy od własnej domeny, kontraktów i kernela. Warstwy application/ports komunikują się z innymi modułami przez `public/index.ts`; nie wiążą adapterów. Mogą korzystać z lokalnego czystego `public/types.ts`, aby tworzyć jawne DTO bez importu fabryki. Typy z Node i pakiety zewnętrzne są niedozwolone w tych czystych warstwach.

Composition root może wiązać konkretne adaptery. `demo/public/index.ts` jest jedynym publicznym wejściem, które może eksportować fabrykę z własnej warstwy composition. Produkcyjne moduły core nie zależą od demo. API może korzystać z Node oraz zadeklarowanych eksportów pakietu backend; względne odwołanie API do pliku backendu jest zabronione nawet wtedy, gdy plik leży w `public`.

Checker wymaga jawnych ścieżek workspaces i jawnych eksportów pakietów; wzorce glob/pattern exports, symlinki źródeł oraz importy zasobów spoza sprawdzanego kodu nie są obsługiwane. Analiza zależności nie zastępuje semantycznego typechecku, testów zachowania ani kontroli uprawnień podczas wykonania. Nie jest zabezpieczeniem przed celowym ukrywaniem kodu w `eval`, generowaniu kodu czy niestandardowym loaderze.
