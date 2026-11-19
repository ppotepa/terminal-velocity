# Terminal Velocity — implementation status, Stage 2

Date: November 19, 2026. Code version: `0.1.0`. The application offers a durable PostgreSQL mode for one complete synthetic message flow, alongside the original memory demonstration. Stage 3 source-observation contracts are implemented on a feature branch; no provider connector or real source is present.

## Implemented

| Area | Implementation |
|---|---|
| Repository | npm workspaces, Node.js 24.x, pinned dependencies, strict TypeScript, AST import checks, and CI configuration |
| Correlation | Temporal strong identifiers, conflict veto, ambiguity, candidate completeness, immutable decision history, current heads, and a PostgreSQL transaction adapter |
| Ingestion | Canonical synthetic message facts, cross-process first-write serialization, durable idempotency, and conflicts for reused IDs with different facts |
| Atomic producer | Message facts, decision revision/head, and matching producer outbox event commit in one PostgreSQL transaction |
| Delivery | Durable fan-out, consumer-specific deliveries, database-clock leases, token fencing, retries, crash recovery, and quarantine |
| Atomic consumer | Consumer inbox, projection effects, and delivery acknowledgment share one PostgreSQL transaction |
| Availability | Reversible contributions, A→B correction, tombstones, revision collision detection, observation-time freshness, and fallback to the prior eligible message |
| API | Six existing endpoints, memory/PostgreSQL configuration, database connectivity checks, body/input limits, safe errors, loopback binding, and resource cleanup |
| Source contracts | Versioned provider-message, receiver-reception, and frame observation models; scoped delivery identity; timestamp evidence; source capability, coverage, and sampling declarations; no provider transport |
| Database operations | Checked-in migrations, checksum tracking, separate schema owner roles, a restricted runtime login, and a local Compose setup |
| Verification | Database-independent checks plus an isolated real PostgreSQL integration suite, including actual API crash/restart |

The workspaces contain **167 TypeScript source files**, checked across **559 AST dependency edges**. Responsibilities are split into parsers, pure rules, use cases, ports, transaction helpers, SQL adapters, queue operations, and composition roots. Generic mechanisms cover concrete shared contracts: `SqlExecutor.query<Row>`, `runSqlTransaction<T>`, `runDecisionWork<T>`, and `AtomicEventConsumer<Writes>`.

## Local verification

| Check | Result |
|---|---|
| Locked installation | PASS with `npm ci --ignore-scripts --no-audit --no-fund` |
| Strict type checking | PASS for both workspaces |
| Architecture boundaries | PASS, 167 source files / 559 dependency edges |
| AST checker regressions | 28/28 PASS |
| Backend database-independent tests | 63/63 PASS |
| HTTP/configuration/shutdown tests | 30/30 PASS |
| Real PostgreSQL integration tests | 37/37 PASS, zero skipped |
| Total automated tests | **158/158 PASS** |
| Memory executable smoke test | PASS: startup, health, example POST/replay, RECENT, clean SIGTERM |
| Core reference example | PASS: correlation, outbox, expiry, and A→B correction |
| Durable executable restart | PASS within integration tests: PostgreSQL startup, ingestion/projection, SIGKILL, restart, restored reads/replay/conflict, clean SIGTERM |

Local verification used Node.js **24.22.3** and actual PostgreSQL **18.7**. The disposable PostgreSQL cluster kept `fsync`, `synchronous_commit`, and full-page writes enabled. Tests used a separate runtime login with the actual restricted grants. Concurrent first-decision tests launched two independent Node processes; other scenarios exercised competing pools, real constraint failures, expired leases, rollback, duplicate consumption, and role separation.

The GitHub Actions workflow now includes PostgreSQL as a service and a mandatory integration step. Earlier runs were blocked before their first job step; the local results above do not establish a successful remote CI run. Check the run attached to the relevant commit for its current result. Compose configuration was parsed and reviewed; Docker was unavailable locally, so the local integration run used PostgreSQL binaries directly.

## Guarantee boundaries

### PostgreSQL mode

`STORAGE_DRIVER=postgres` requires an explicit runtime `DATABASE_URL` and previously applied migrations. The API never migrates the database or uses administrative credentials. Successful ingestion commits immutable facts, its decision, and the outbox together. A disconnected client may not know whether a commit completed; replaying the same message ID and facts resolves that uncertainty.

Availability is eventually consistent with accepted messages. The worker commits the consumer inbox, contribution, and acknowledgment together. A stale lease detected before projection or during the final acknowledgment update rolls back pending effects. The delivery row remains locked through commit; expiry is not a deadline on the commit response. Exactly-once SQL effects are limited to one consumer/event identity inside that transaction. Arbitrary external side effects are not covered.

Contribution revision follows decision revision only inside this fixed synthetic visibility scope. Clients cannot submit publication grants or eligibility. The scope is not a production access policy and cannot stand in for independent grant/publication revisions.

Durable storage does not have the memory mode's 500-message lifetime cap. Aircraft message lists are bounded to the 500 newest records. There is no paginated history API, automatic retention, public correction endpoint, database backup/restore procedure, or production capacity claim. Freshness is recalculated on reads; this stage does not introduce a durable expiry scheduler or incremental map stream.

### Memory mode

Memory remains the default. It stages a single `DemoState` swap under a mutex, is limited to 500 messages, and loses data/idempotency on restart. It does not acquire PostgreSQL's persistence or cross-process isolation guarantees.

### Shared scope

Aircraft position storage, identity, projection, and UI remain unimplemented. S4-02 adds an opt-in private adsb.lol adapter, but no live result is persisted or publicly served. Messages are decoded text examples, not captured RF frames. No real Airframes message connector, moving map frontend, flight sessions, reassembly, entitlement enforcement, or public deployment has been added.

The architecture v2 catalog still describes 89 intended responsibilities rather than 89 completed services. Stage 3 currently has only the provider-neutral S3-01 contracts; there is no selected or authorized real source, transport, provider fixture, or source persistence. Its source contracts do not grant publication rights. The historical DDL and target event envelope remain design documents; the implemented schema is under `db/migrations`, and the current event is `correlation.aircraft-decision-revised.v1`.

See [POSTGRES.md](POSTGRES.md) for setup and operational behavior, [API.md](API.md) for the HTTP contract, and [ROADMAP.md](ROADMAP.md) for Stage 3: one real connector with established access and permitted usage.

## Stage 3 contract work — S3-01 feature branch

The `feature/s3-01-source-observation-contracts` branch adds only provider-neutral source contracts. It does not select a provider, connect to a source, store source deliveries, or authorize publication.

Local verification used Node.js 24.22.3:

| Command | Result |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | PASS; 20 locked packages installed |
| `npm run check` | PASS; strict type checks, 177 source files / 593 dependency edges, 28/28 architecture tests, 76/76 backend tests, 30/30 API tests (134 total, including 13 source-observation tests) |
| `npm run test:postgres:local` | PASS; 37/37 integration tests on isolated PostgreSQL 17.12, durability settings enabled |
| `npm run demo` | PASS; correlation, outbox, freshness, and correction example completed |
| `npm run smoke` | PASS; API startup, health, message replay, and clean SIGTERM shutdown |
| GitHub Actions for PR #54 | BLOCKED; `verify` runs failed before any steps and produced no job logs; the exact cause is not exposed |

The local sequence covers every step in the repository CI workflow. The database integration run used Debian PostgreSQL 17.12 because that is the version available from this host's Debian 13 repository; the workflow currently specifies PostgreSQL 18.7. No database or transaction code changed in S3-01. The repository has a known Actions billing blocker; remote failures are consistent with it, but the available run output does not confirm the cause. No remote CI pass is claimed.

## Stage 3 source decision — S3-02

The first-party source review is recorded in [`adr/0001-first-message-source.md`](adr/0001-first-message-source.md). The outcome is **BLOCKED_PENDING_RIGHTS / NO-GO**: no message provider or project-owned receiver has verified access, account-level permissions, a permitted fixture, and retention terms. Airframes' API/access documentation and licensing are marked under development; this project has no feeder station, key, or early-access approval. The adsb.lol public API is a positions source under ODbL, while its documented ACARS/VDL2/HFDL endpoints accept contributor submissions under CC0 and do not provide an inbound message API. No connector or live-data claim is made. S3-03 through S3-13 remain gated on the unblock conditions in the ADR.

## Stage 4 position contract work — S4-01 in review (PR #56)

The `feature/s4-01-position-contracts` branch adds a versioned, provider-neutral position observation parser, typed coordinate/source identifiers, an adapter port, and contract tests. It preserves ADS-B versus MLAT, observed versus ingested time, direct versus age-derived timestamp basis and uncertainty, tagged altitude/track kinds, source-reported position quality, and omitted/null/zero optional measurements. It does not include a provider parser, live feed, storage, aircraft identity resolution, freshness projection, or map. No live-data or authorization claim is made.

Local verification used Node.js **24.22.3** and Debian PostgreSQL **17.12**:

| Command | Result |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | PASS; 20 locked packages installed |
| `npm run check` | PASS; strict types, 184 source files / 614 dependency edges, 28/28 architecture tests, 87/87 backend tests, 30/30 API tests (145 total) |
| `npm run test:postgres:local` | PASS; 37/37 isolated PostgreSQL integration tests; durability settings enabled |
| `npm run demo` | PASS; durable-domain example completed |
| `npm run smoke` | PASS; API startup, health, replay, and clean SIGTERM shutdown |

The PostgreSQL run exercised the existing durable message flow; S4-01 adds no database changes. The ephemeral database was started on loopback by the local integration harness and removed after the run. GitHub Actions results remain separate; this local run does not claim a remote CI pass. No public listener or deployment was started.

## Stage 4 private position source — S4-02 implementation

The `feature/s4-02-adsblol-position-source` branch adds an adsb.lol v2 point/radius parser and bounded HTTPS transport over the S4-01 observation contract. It maps age-derived timestamps, ADS-B/MLAT/other source types, coordinates, tagged altitude and track, optional measurements, ICAO/source-local ID hints, and source quality. Snapshot coverage is explicitly sampled with unknown completeness. The transport has an 8-second timeout, 1 MB response limit, 50 NM radius cap, and a process-shared budget of one request per 10 minutes and 200 per rolling 24 hours. Its explicit poller honors `Retry-After`, uses capped exponential backoff, exposes separate transport health, and stops cleanly on abort. Creation alone never polls.

The source decision in [`adr/0002-position-source.md`](adr/0002-position-source.md) permits private/local use under ODbL 1.0 only. The fixture is synthetic, no database/API/UI wiring or persistent storage was added, and public use/deployment remains NO-GO pending Stage 5 publication controls and issue #46 licensing review.

Local verification used Node.js **24.22.3** and Debian PostgreSQL **17.12**:

| Command | Result |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | PASS; 20 locked packages installed |
| `PATH=/root/work/toolchains/node-24.22.3:$PATH npm run check` | PASS; 191 source files / 637 AST dependencies, 28/28 architecture tests, 100/100 backend tests, 30/30 API tests (158 total) |
| `PATH=/root/work/toolchains/node-24.22.3:$PATH npm run test:postgres:local` | PASS; 37/37 integration tests on isolated PostgreSQL 17.12 with durability enabled; temporary cluster removed |
| `PATH=/root/work/toolchains/node-24.22.3:$PATH npm run demo` | PASS; durable-domain example completed |
| `PATH=/root/work/toolchains/node-24.22.3:$PATH npm run smoke` | PASS; loopback API startup, health, replay, and clean SIGTERM shutdown |
| Bounded private adsb.lol smoke | PASS; 1 NM query returned zero positions; 10 NM query parsed 7 canonical observations; only aggregate counts were printed and no response rows were retained |
| `git diff --check` | PASS |

S4-02 has no SQL change, so PostgreSQL was run as repository regression verification only. The ephemeral cluster bound to loopback and was removed by the harness; the system PostgreSQL service remains inactive. Manual source checks were two outbound HTTPS requests and opened no local listener. These results are local; GitHub Actions has not produced a passing run for this branch, and no remote green result is claimed. No deployment or public listener was started. PR link will be added after publishing the review branch.
