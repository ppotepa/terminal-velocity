# SRP module catalog — v2

**Target catalog, not a list of completed implementations.** Each row represents a cohesive code responsibility; it does not have to become a separate package, process or table. `reference/` implements selected correlation and availability responsibilities. Public implementation filenames may be more specific than the module names.

Each module should have a model owner, a public contract, documented inputs and outputs, and tests for its own invariants. An I/O interface exists only where I/O actually occurs.

## fleet-identity

| Module | Single responsibility | Reason to change |
|---|---|---|
| `identity-values` | Validate ICAO24, registrations and internal IDs | Changes to validity rules for a specific identifier |
| `identity-assertions` | Record source assertions with provenance | Changes to how identity evidence is recorded |
| `temporal-aliases` | Look up an alias for the event time | Changes to alias validity policy |
| `identity-conflicts` | Detect simultaneous contradictory assertions | Changes to the definition of a conflict |
| `identity-revisions` | Retain the revision history of accepted state | Changes to correction and audit rules |

## flight-tracking

| Module | Single responsibility | Reason to change |
|---|---|---|
| `position-validation` | Validate position ranges, units, time and quality | Changes to observation acceptance rules |
| `position-ledger` | Append observations without overwriting history | Changes to the fact persistence contract |
| `current-position-selection` | Select the current observation with a tie-breaker | Changes to rules for competing sources |
| `session-boundaries` | Open, split and close sessions while preserving uncertainty | Changes to the definition of a flight segment |
| `session-assignment` | Version the assignment of positions to sessions | Changes to segmentation corrections |
| `track-building` | Build an observed track from observations | Changes to how points are connected |
| `track-simplification` | Simplify geometry for the given zoom level | Changes to rendering budgets and quality |

## communications

| Module | Single responsibility | Reason to change |
|---|---|---|
| `delivery-intake` | Validate and accept source data | Changes to the input contract |
| `input-level-routing` | Choose the frame/fragment/provider-message path | Changes to supported data levels |
| `observation-time` | Select the time and quality of the time basis | Changes to timestamp trust rules |
| `delivery-idempotency` | Recognize repeated delivery | Changes to source ID guarantees |
| `reception-ledger` | Retain receptions and receiver metadata | Changes to reception evidence persistence |
| `frame-candidate-search` | Find potentially identical transmission occurrences | Changes to the index or time-window search |
| `frame-equivalence` | Determine whether receptions share a frame occurrence | Changes to protocol equivalence rules |
| `reception-assignment` | Associate receptions with a frame and record corrections | Changes to grouping history |
| `protocol-decoding` | Run the appropriate decoder adapter | A new decoder version or type |
| `fragment-extraction` | Extract a fragment and sequence metadata | Changes to the fragmentation format |
| `assembly-key` | Determine the assembly context | Changes to message identification rules |
| `message-assembly` | Manage collecting/complete/conflicted/expired state | Changes to completeness rules |
| `message-revisions` | Append a decoding result with its input references | Changes to the interpretation schema |
| `message-provenance` | Reconstruct payload and field provenance | Changes to evidence tracking rules |

## correlation

| Module | Single responsibility | Reason to change |
|---|---|---|
| `aircraft-hints` | Extract identity hints including the address role | Changes to source field semantics |
| `aircraft-candidates` | Retrieve the complete set of time-dependent candidates | Changes to index queries |
| `aircraft-evidence` | Compare strong identifiers and evidence | Changes to an individual evidence rule |
| `aircraft-decision` | Determine uniqueness, apply conflict vetoes or return no match | Changes to decision policy |
| `flight-candidates` | Find sessions for an aircraft and time | Changes to candidate session selection |
| `flight-evidence` | Compare time, callsign and aircraft consistency | Changes to session matching rules |
| `flight-decision` | Make a separate session decision without forcing a match | Changes to flight assignment policy |
| `link-revision-commit` | Atomically persist the decision and outbox entry | Changes to the durable commit contract |
| `correlation-reprocessing` | Plan reevaluation of a scope | Changes to correction or replay triggers |

## availability

| Module | Single responsibility | Reason to change |
|---|---|---|
| `contribution-eligibility` | Determine whether a permitted message contributes to this status | Changes to status eligibility rules |
| `contribution-ledger` | Replace or retract one message contribution with a revision | Changes to contribution semantics |
| `latest-eligible-message` | Select the latest message that remains valid | Changes to selection rules and filters |
| `freshness-policy` | Classify message age with a pure rule | Changes to freshness thresholds |
| `transition-planning` | Calculate the next transition time | Changes to deadline policy |
| `expiry-processing` | Process a deadline with expectedRevision | Changes to overdue job behavior |
| `availability-reconciliation` | Recalculate from contributions after a correction or restart | Changes to projection repair |

## receiver-network

| Module | Single responsibility | Reason to change |
|---|---|---|
| `station-registration` | Register a station and its owner | Changes to the station lifecycle |
| `receiver-capabilities` | Describe receiver and decoder capabilities | Changes to the capabilities format |
| `heartbeat` | Record process liveness and the latest connection | Changes to the heartbeat protocol |
| `station-health` | Determine reception quality independently of frame counts | Changes to station health rules |
| `location-exposure` | Determine the permitted precision of station location | Changes to owner preferences |

## publication

| Module | Single responsibility | Reason to change |
|---|---|---|
| `source-entitlements` | Determine usage rights for a source's fields and data | Changes to usage terms |
| `message-eligibility` | Decide whether a message is permitted within a scope | Changes to visibility policy |
| `published-view` | Build the public field set and provenance | Changes to the exposure schema |
| `visibility-grants` | Version permissions and revocations | Changes to the data access rights lifecycle |
| `scope-epochs` | Invalidate caches and replay after policy changes | Changes to permission synchronization rules |

## access

| Module | Single responsibility | Reason to change |
|---|---|---|
| `principal-resolution` | Identify the user or feeder | Changes to the authentication mechanism |
| `capability-authorization` | Check permission for a specific operation | Changes to the authorization matrix |
| `feeder-credentials` | Issue, rotate and revoke station tokens | Changes to the credential lifecycle |

## source-connectors (technical)

| Module | Single responsibility | Reason to change |
|---|---|---|
| `connection-lifecycle` | Connect, reconnect and shut down the provider connection | Changes to provider transport |
| `provider-budget` | Manage limits, retry-after and polling schedules | Changes to the API request budget |
| `wire-codecs` | Validate a specific payload version | Changes to the provider's JSON contract |
| `coverage-descriptors` | Describe known feed coverage and sampling | Changes to source capabilities |
| `source-health` | Measure lag and connection availability | Changes to the operational definition of quality |

## read-models (application)

| Module | Single responsibility | Reason to change |
|---|---|---|
| `map-projection` | Maintain a denormalized map record per scope | Changes to map read requirements |
| `map-change-log` | Atomically record the delta and projection checkpoint | Changes to map synchronization |
| `message-timeline` | List messages with keyset pagination | Changes to message panel requirements |
| `flight-list` | Provide an efficient flight table and search | Changes to search requirements |
| `station-cards` | Provide a station list and preview | Changes to station view requirements |
| `projection-rebuild` | Build a new generation, backfill and perform controlled cutover | Changes to read-model rebuilding |

## delivery (application)

| Module | Single responsibility | Reason to change |
|---|---|---|
| `subscription-validation` | Validate the bbox, filters and request limits | Changes to permitted subscriptions |
| `subscription-authorization` | Resolve the current scope and policy epoch | Changes to client access |
| `snapshot-barrier` | Start snapshot and delta delivery consistently | Changes to the startup protocol |
| `resume-tokens` | Handle a signed opaque cursor and scope compatibility | Changes to the resume format |
| `viewport-membership` | Track objects entering or leaving the filter/bbox | Changes to visibility semantics |
| `delta-batching` | Batch upserts and removals per subscription | Changes to data packaging |
| `backpressure` | Manage the queue budget and resync decision | Changes to slow-client handling |

## platform (technical)

| Module | Single responsibility | Reason to change |
|---|---|---|
| `event-codecs` | Validate envelope and payload versions | Changes to the event contract |
| `outbox-append` | Write the event within the owner's transaction | Changes to persistence mechanics |
| `outbox-dispatch` | Provide durable fan-out to independent consumers | Changes to routing mechanics |
| `delivery-lease` | Claim work and issue an attempt token | Changes to concurrent execution |
| `consumer-inbox` | Deduplicate effects per consumer,event | Changes to consumption semantics |
| `retry-planning` | Calculate backoff and determine retry eligibility with pure rules | Changes to failure policy |
| `quarantine` | Retain rejected work and its reason | Changes to permanent failure handling |
| `payload-storage` | Manage immutable bytes, checksums and retention | Changes to the storage adapter |
| `observability` | Provide consistent traces and metrics without payload content | Changes to operational requirements |

## frontend (presentation)

| Module | Single responsibility | Reason to change |
|---|---|---|
| `viewport-state` | Maintain zoom and bbox | Changes to map interactions |
| `aircraft-selection` | Keep the selected aircraft/session in the URL | Changes to user navigation |
| `status-presentation` | Present labels, colors, outlines and data descriptions | Changes to the visual language |
| `map-delta-reducer` | Apply generation,cursor,revision | Changes to the client protocol |
| `message-expansion` | Open the content of a single message | Changes to panel interactions |
| `filter-serialization` | Serialize filters into the URL and query | Changes to the filter model |
| `design-primitives` | Button, Panel, Input, DataTable<Row> | Changes to the shared design system |

## The boundary of useful decomposition

Split a module when its parts change independently, have separate invariants or use a different I/O source. Combine files when they express nothing on their own, always change together and merely forward arguments. Pure local helpers do not require a public interface or a separate adapter.

The catalog contains **89 responsibilities** across 13 areas. That count follows from the product description; it is neither an architectural target nor a limit.
