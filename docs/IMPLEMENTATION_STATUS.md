# Terminal Velocity — implementation status, Stage 2

Date: November 19, 2026. Code version: `0.1.0`. The application now offers a durable PostgreSQL mode for one complete synthetic message flow, alongside the original memory demonstration.

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

Aircraft positions and identities remain synthetic fixtures. Coverage is `UNKNOWN`; real feed health is `DISCONNECTED`. Messages are decoded text examples, not captured RF frames. No real Airframes/ADS-B connector, moving map frontend, flight sessions, reassembly, entitlement enforcement, or public deployment has been added.

The architecture v2 catalog still describes 89 intended responsibilities rather than 89 completed services. Its historical DDL and target event envelope remain design documents; the implemented schema is under `db/migrations`, and the current event is `correlation.aircraft-decision-revised.v1`.

See [POSTGRES.md](POSTGRES.md) for setup and operational behavior, [API.md](API.md) for the HTTP contract, and [ROADMAP.md](ROADMAP.md) for Stage 3: one real connector with established access and permitted usage.
