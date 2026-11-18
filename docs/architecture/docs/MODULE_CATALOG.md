# Katalog modułów SRP — v2

**Katalog docelowy, nie lista gotowych implementacji.** Wiersz oznacza spójną odpowiedzialność kodową; nie musi stać się osobnym pakietem, procesem ani tabelą. `reference/` realizuje wybrane odpowiedzialności korelacji i availability. Publiczne nazwy plików implementacji mogą być bardziej precyzyjne od nazw modułów.

Każdy moduł powinien mieć właściciela modelu, publiczny kontrakt, opis danych wejściowych/wyjściowych i testy własnych niezmienników. Interfejs do I/O istnieje tylko tam, gdzie I/O rzeczywiście występuje.

## fleet-identity

| Moduł | Jedna odpowiedzialność | Powód zmiany |
|---|---|---|
| `identity-values` | Walidacja ICAO24, rejestracji i wewnętrznych ID | Zmiana poprawności konkretnego identyfikatora |
| `identity-assertions` | Zapis twierdzeń źródeł z pochodzeniem | Zmiana sposobu zapisu dowodu tożsamości |
| `temporal-aliases` | Odczyt aliasu dla czasu zdarzenia | Zmiana polityki ważności aliasów |
| `identity-conflicts` | Wykrycie równoczesnych sprzecznych twierdzeń | Zmiana definicji konfliktu |
| `identity-revisions` | Historia rewizji przyjętego stanu | Zmiana reguł korekt i audytu |

## flight-tracking

| Moduł | Jedna odpowiedzialność | Powód zmiany |
|---|---|---|
| `position-validation` | Walidacja zakresów, jednostek, czasu i jakości pozycji | Zmiana dopuszczalności obserwacji |
| `position-ledger` | Append obserwacji, bez nadpisania historii | Zmiana kontraktu zapisu faktu |
| `current-position-selection` | Wybór aktualnej obserwacji z tie-breakerem | Zmiana reguł konkurujących źródeł |
| `session-boundaries` | Otwarcie, podział i zamknięcie sesji z niepewnością | Zmiana definicji odcinka lotu |
| `session-assignment` | Wersjonowane przypisanie pozycji do sesji | Zmiana korekt segmentacji |
| `track-building` | Zbudowanie śladu z obserwacji | Zmiana sposobu łączenia punktów |
| `track-simplification` | Uproszczenie geometrii pod dany zoom | Zmiana budżetu i jakości renderowania |

## communications

| Moduł | Jedna odpowiedzialność | Powód zmiany |
|---|---|---|
| `delivery-intake` | Sprawdzenie i przyjęcie danych źródła | Zmiana kontraktu wejściowego |
| `input-level-routing` | Wybór ścieżki frame/fragment/provider-message | Zmiana obsługiwanych poziomów danych |
| `observation-time` | Wybór czasu i jakości podstawy czasowej | Zmiana zaufania do timestampów |
| `delivery-idempotency` | Rozpoznanie ponownej dostawy | Zmiana gwarancji ID źródła |
| `reception-ledger` | Zachowanie odbioru i receiver metadata | Zmiana zapisu dowodów odbioru |
| `frame-candidate-search` | Znalezienie potencjalnie tej samej transmisji | Zmiana indeksu/wyszukiwania okna |
| `frame-equivalence` | Rozstrzygnięcie wspólnego wystąpienia ramki | Zmiana reguł równoważności protokołu |
| `reception-assignment` | Powiązanie odbiorów z ramką i korekty | Zmiana historii grupowania |
| `protocol-decoding` | Uruchomienie właściwego adaptera dekodera | Nowa wersja lub rodzaj dekodera |
| `fragment-extraction` | Wyodrębnienie fragmentu i metadanych sekwencji | Zmiana formatu fragmentacji |
| `assembly-key` | Ustalenie kontekstu składania | Zmiana reguł identyfikacji wiadomości |
| `message-assembly` | Stan collecting/complete/conflicted/expired | Zmiana reguł kompletności |
| `message-revisions` | Append wyniku dekodowania z wejściowymi referencjami | Zmiana schematu interpretacji |
| `message-provenance` | Odtworzenie pochodzenia payloadu i pól | Zmiana reguł śledzenia dowodów |

## correlation

| Moduł | Jedna odpowiedzialność | Powód zmiany |
|---|---|---|
| `aircraft-hints` | Wydobycie wskazówek wraz z rolą adresu | Zmiana semantyki pól źródła |
| `aircraft-candidates` | Pobranie pełnego zestawu temporalnych kandydatów | Zmiana pytań do indeksu |
| `aircraft-evidence` | Porównanie mocnych identyfikatorów i dowodów | Zmiana pojedynczej reguły dowodowej |
| `aircraft-decision` | Jednoznaczność, veto konfliktu, brak wyniku | Zmiana polityki decyzji |
| `flight-candidates` | Wyszukanie sesji dla maszyny i czasu | Zmiana wyboru sesji kandydackich |
| `flight-evidence` | Porównanie czasu, callsign i zgodności maszyny | Zmiana reguł dopasowania sesji |
| `flight-decision` | Osobna decyzja o sesji bez wymuszania wyniku | Zmiana polityki przypisania lotu |
| `link-revision-commit` | Atomowy zapis decyzji i outbox | Zmiana kontraktu trwałego zatwierdzenia |
| `correlation-reprocessing` | Plan ponownego przeliczenia zakresu | Zmiana triggerów korekt/replay |

## availability

| Moduł | Jedna odpowiedzialność | Powód zmiany |
|---|---|---|
| `contribution-eligibility` | Czy dozwolona wiadomość wpływa na ten status | Zmiana kwalifikacji do statusu |
| `contribution-ledger` | Replacement/retraction jednej wiadomości z rewizją | Zmiana semantyki wkładu |
| `latest-eligible-message` | Wybór ostatniej nadal ważnej wiadomości | Zmiana reguł selekcji i filtrów |
| `freshness-policy` | Czysta klasyfikacja wieku wiadomości | Zmiana progów świeżości |
| `transition-planning` | Obliczenie następnego czasu zmiany | Zmiana polityki terminów |
| `expiry-processing` | Obsługa terminu z expectedRevision | Zmiana zachowania przeterminowanych prac |
| `availability-reconciliation` | Przeliczenie z wkładów po korekcie/restart | Zmiana naprawy projekcji |

## receiver-network

| Moduł | Jedna odpowiedzialność | Powód zmiany |
|---|---|---|
| `station-registration` | Rejestracja stacji i jej właściciela | Zmiana lifecycle stacji |
| `receiver-capabilities` | Możliwości odbiornika i dekodera | Zmiana formatu capabilities |
| `heartbeat` | Fakt życia procesu i ostatnie połączenie | Zmiana protokołu heartbeat |
| `station-health` | Stan jakości odbioru, niezależny od liczby ramek | Zmiana reguł zdrowia stacji |
| `location-exposure` | Dopuszczalna precyzja lokalizacji stacji | Zmiana preferencji właściciela |

## publication

| Moduł | Jedna odpowiedzialność | Powód zmiany |
|---|---|---|
| `source-entitlements` | Prawa do pól i danych konkretnego źródła | Zmiana warunków wykorzystania |
| `message-eligibility` | Decyzja dopuszczenia wiadomości dla scope | Zmiana polityki widoczności |
| `published-view` | Budowa publicznego zestawu pól i pochodzenia | Zmiana schematu ekspozycji |
| `visibility-grants` | Wersjonowane pozwolenia i wycofania | Zmiana lifecycle prawa do danych |
| `scope-epochs` | Unieważnienie cache i replay po zmianie polityki | Zmiana reguł synchronizacji uprawnień |

## access

| Moduł | Jedna odpowiedzialność | Powód zmiany |
|---|---|---|
| `principal-resolution` | Ustalenie użytkownika lub feedera | Zmiana sposobu uwierzytelniania |
| `capability-authorization` | Sprawdzenie uprawnienia do konkretnej operacji | Zmiana matrycy uprawnień |
| `feeder-credentials` | Wydanie, rotacja i odwołanie tokenu stacji | Zmiana lifecycle poświadczeń |

## source-connectors (techniczne)

| Moduł | Jedna odpowiedzialność | Powód zmiany |
|---|---|---|
| `connection-lifecycle` | Connect/reconnect/shutdown dostawcy | Zmiana transportu providera |
| `provider-budget` | Limity, retry-after i harmonogram odpytywania | Zmiana budżetu API |
| `wire-codecs` | Walidacja konkretnej wersji payloadu | Zmiana kontraktu JSON dostawcy |
| `coverage-descriptors` | Znany zakres feedu i jego próbkowanie | Zmiana możliwości źródła |
| `source-health` | Pomiar lag i dostępności połączenia | Zmiana operacyjnej definicji jakości |

## read-models (aplikacyjne)

| Moduł | Jedna odpowiedzialność | Powód zmiany |
|---|---|---|
| `map-projection` | Zdenormalizowany rekord mapy per scope | Zmiana potrzeb odczytu mapy |
| `map-change-log` | Atomowy zapis delty i checkpointu projekcji | Zmiana synchronizacji mapy |
| `message-timeline` | Lista wiadomości z keyset pagination | Zmiana potrzeb panelu wiadomości |
| `flight-list` | Wydajna tabela i wyszukiwanie lotów | Zmiana potrzeb wyszukiwarki |
| `station-cards` | Lista i podgląd stacji | Zmiana potrzeb widoku stacji |
| `projection-rebuild` | Nowa generacja, backfill, kontrolowany cutover | Zmiana procesu odbudowy odczytu |

## delivery (aplikacyjne)

| Moduł | Jedna odpowiedzialność | Powód zmiany |
|---|---|---|
| `subscription-validation` | Bbox, filtry i limity żądania | Zmiana dopuszczalnych subskrypcji |
| `subscription-authorization` | Aktualny scope i policy epoch | Zmiana dostępu klienta |
| `snapshot-barrier` | Spójne uruchomienie snapshot i delta | Zmiana protokołu startu |
| `resume-tokens` | Podpisany opaque cursor i zgodność zakresu | Zmiana formatu wznowienia |
| `viewport-membership` | Wejście i wyjście obiektu z filtra/bbox | Zmiana semantyki widoczności |
| `delta-batching` | Upsert/remove i batching per subskrypcja | Zmiana pakietowania danych |
| `backpressure` | Budżet kolejki i decyzja resync | Zmiana obsługi powolnego klienta |

## platform (techniczne)

| Moduł | Jedna odpowiedzialność | Powód zmiany |
|---|---|---|
| `event-codecs` | Walidacja wersji koperty i payloadu | Zmiana kontraktu eventu |
| `outbox-append` | Zapis eventu w transakcji właściciela | Zmiana mechaniki zapisu |
| `outbox-dispatch` | Trwały fan-out dla niezależnych konsumentów | Zmiana mechaniki routingu |
| `delivery-lease` | Claim pracy i token próby | Zmiana konkurencyjnego wykonania |
| `consumer-inbox` | Deduplikacja efektu per consumer,event | Zmiana semantyki konsumpcji |
| `retry-planning` | Czysty backoff i kwalifikacja retry | Zmiana polityki awarii |
| `quarantine` | Zachowanie odrzuconej pracy i powodu | Zmiana obsługi trwałych błędów |
| `payload-storage` | Immutable bytes, checksum, retencja | Zmiana adaptera storage |
| `observability` | Spójne trace i metryki bez treści payloadów | Zmiana wymagań operacyjnych |

## frontend (prezentacja)

| Moduł | Jedna odpowiedzialność | Powód zmiany |
|---|---|---|
| `viewport-state` | Zoom i bbox | Zmiana interakcji mapy |
| `aircraft-selection` | Wybrana maszyna/sesja w URL | Zmiana nawigacji użytkownika |
| `status-presentation` | Etykieta, kolor, obrys i opis danych | Zmiana języka wizualnego |
| `map-delta-reducer` | Stosowanie generation,cursor,revision | Zmiana protokołu klienta |
| `message-expansion` | Otwarcie treści pojedynczej wiadomości | Zmiana interakcji panelu |
| `filter-serialization` | URL i query filtrów | Zmiana modelu filtrów |
| `design-primitives` | Button,Panel,Input,DataTable<Row> | Zmiana wspólnego design systemu |

## Granica rozsądnego rozdrobnienia

Rozbijamy moduł, jeżeli jego części zmieniają się niezależnie, mają odrębne niezmienniki lub inne źródło I/O. Łączymy pliki, jeżeli osobno niczego nie wyrażają, zawsze zmieniają się razem i jedynie przekazują argumenty. Czyste helpery lokalne nie wymagają publicznego interfejsu ani osobnego adaptera.

Katalog zawiera **89 odpowiedzialności** w 13 obszarach. Ta liczba jest wynikiem opisu produktu, nie celem ani limitem architektury.
