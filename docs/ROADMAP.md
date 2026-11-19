# Implementation roadmap

Each stage should produce a runnable application slice and a PR with behavioral tests. Code boundaries follow the responsibilities described in architecture v2.

## Stage 1 — local demonstration backend

**Status: complete.** The memory-backed demonstration remains available.

Repository foundation, npm workspaces, strict TypeScript, AST import checks, and CI configuration. The existing Message→Aircraft correlation and reversible availability statuses work through a small HTTP API. Position and catalog fixtures are synthetic. Message ingestion is idempotent during the lifetime of one process. Reusing an ID with different facts is a conflict, not an implicit history correction.

## Stage 2 — durable storage for one flow

**Status: implemented for the fixed synthetic message flow.** See [POSTGRES.md](POSTGRES.md) for startup, migrations, delivery behavior, and integration tests. The flow is message facts → decision/history/outbox → consumer inbox/availability, with PostgreSQL mode available through the existing HTTP API.

A PostgreSQL adapter behind the transaction port, decision history, an outbox, and a consumer-specific inbox. Integration tests on real PostgreSQL cover concurrent first writes, rollback on outbox failure, leasing, crash recovery, and atomic deduplication. Turn the DDL design into real migrations with separate schema ownership roles. This stage makes durability an application property.

## Stage 3 — one real connector

**Status: engineering in progress; real-source acceptance blocked.** Synthetic source contracts, private processing and bounded replay exist, but no authorized retained Airframes sample has been validated end to end. The durable Stage 2 adapters do not establish rights to collect, retain or publish real radio messages. See the [issue #13 source validation runbook](SOURCE_INTEGRATION_RUNBOOK.md).

Select a source for which access and permitted usage are established. The adapter stores source deliveries, receptions, and message facts separately. It preserves provenance, timestamp uncertainty, bearer, and decoder version. It must not invent RF frames when a provider supplies only decoded messages. Add contract tests using anonymized source examples, retries, backoff, quarantine, and bounded backfill.

## Stage 4 — positions and map reads

A separate position adapter, observations with timestamps and provenance, stable aircraft identity, and a map read model. The first map version may fetch a coherent snapshot over HTTP. Flight history and position freshness do not depend on the presence of radio messages. The frontend keeps the agreed minimal design: map, list, details, and clear statuses.

## Stage 5 — visibility and incremental updates

Enforce publication scope before deriving aircraft counts and colors. Add entitlement and grant revisions, contribution retractions, and tests that hidden messages do not leak their existence. Then implement snapshot + replay + an `upsert/remove` stream, subscription generations, scope-bound cursors, and recovery after disconnection.

## Stage 6 — domain expansion

Message→FlightSession correlation independent of Message→Aircraft, reassembly, multiple stations, different protocols, history, geographic filters, telemetry, and justified indexes. Introduce a broker and separate processes when measured traffic and isolation needs warrant them. They are not prerequisites for implementing the domains.

## Public deployment readiness

Build on the durable Stage 2 flow with access-control ports, source-specific resource limits and failure handling, publication rights, retention, operational monitoring, and recovery procedures. The fixed synthetic scope must be replaced before real public data is served. Limitations of the in-memory demonstrator must not be presented as production guarantees.
