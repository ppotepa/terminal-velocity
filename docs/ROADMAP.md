# Kolejność wdrażania

Każdy etap powinien kończyć się uruchamialnym przekrojem aplikacji i PR-em z testami zachowań. Podział kodu wynika z odpowiedzialności opisanych w architekturze v2.

## Etap 1 — lokalny backend demonstracyjny

Podstawa repozytorium, npm workspaces, strict TypeScript, kontrola importów AST, CI. Istniejąca korelacja Message→Aircraft i odwracalne statusy działają przez małe API HTTP. Fixture pozycji i katalogu są syntetyczne. Przyjęcie komunikatu jest idempotentne w czasie życia jednego procesu. Powtórzone ID z innymi faktami jest konfliktem, a nie niejawną korektą historii.

## Etap 2 — trwały zapis jednego przepływu

Adapter PostgreSQL za portem transakcji, historia decyzji, outbox i inbox konkretnego konsumenta. Testy integracyjne na rzeczywistym PostgreSQL: równoczesny pierwszy zapis, rollback przy błędzie outboxu, leasing, wznowienie po awarii i atomowa deduplikacja. Uzupełnienie projektu DDL o rzeczywiste migracje z osobnymi rolami właścicielskimi schematów. W tym etapie trwałość staje się właściwością aplikacji.

## Etap 3 — pojedynczy rzeczywisty konektor

Wybrać źródło, dla którego mamy dostęp i dozwolony zakres wykorzystania. Adapter osobno przechowuje source delivery, recepcję i fakty wiadomości. Zachowuje pochodzenie, niepewność czasu, bearer i wersję dekodera. Nie tworzy sztucznych ramek RF, jeśli dostawca oferuje tylko zdekodowaną wiadomość. Testy kontraktu na zanonimizowanych przykładach źródła; retry, backoff, kwarantanna i ograniczony backfill.

## Etap 4 — pozycje i odczyt mapy

Oddzielny adapter pozycji, obserwacje z czasem i źródłem, stabilna tożsamość samolotu, model widoku mapy. W pierwszej wersji mapa może pobierać spójny snapshot przez HTTP. Historia lotu i oznaczenie świeżości pozycji nie zależą od obecności komunikatów radiowych. Frontend zachowuje uzgodniony minimalizm: mapa, lista, szczegóły i czytelne statusy.

## Etap 5 — widoczność i aktualizacje przyrostowe

Egzekwowanie publication scope przed licznikiem i kolorem samolotu. Rewizje uprawnień i grantów, wycofywanie wkładów, test braku wycieku istnienia ukrytych wiadomości. Dopiero potem snapshot + replay + strumień `upsert/remove`, generacje subskrypcji, scope-bound cursors i odtwarzanie po zerwaniu połączenia.

## Etap 6 — rozszerzanie domen

Korelacja Message→FlightSession niezależnie od Message→Aircraft, reassembly, wiele stacji, różne protokoły, historia, geofiltry, telemetria i uzasadnione indeksy. Broker i oddzielne procesy wynikają z pomiarów ruchu oraz potrzeb izolacji. Nie są warunkiem rozpoczęcia implementacji domen.

## Warunek gotowości do publicznego uruchomienia

Zastąpienie jawnego trybu demo rzeczywistymi portami trwałości i kontroli dostępu, ograniczenia zasobów, obsługa awarii źródeł, dopuszczone prawa do publikacji i testy integracyjne. Ograniczenia pamięciowego demonstratora nie mogą zostać opisane jako gwarancje produkcyjne.
