# Implementation roadmap

Each stage should produce a runnable application slice and a PR with behavioral tests. Code boundaries follow the responsibilities described in architecture v2.

## Stage 1 — local demonstration backend

Repository foundation, npm workspaces, strict TypeScript, AST import checks, and CI configuration. The existing Message→Aircraft correlation and reversible availability statuses work through a small HTTP API. Position and catalog fixtures are synthetic. Message ingestion is idempotent during the lifetime of one process. Reusing an ID with different facts is a conflict, not an implicit history correction.

## Stage 2 — durable storage for one flow

A PostgreSQL adapter behind the transaction port, decision history, an outbox, and a consumer-specific inbox. Integration tests on real PostgreSQL cover concurrent first writes, rollback on outbox failure, leasing, crash recovery, and atomic deduplication. Turn the DDL design into real migrations with separate schema ownership roles. This stage makes durability an application property.

## Stage 3 — one real connector

Select a source for which access and permitted usage are established. The adapter stores source deliveries, receptions, and message facts separately. It preserves provenance, timestamp uncertainty, bearer, and decoder version. It must not invent RF frames when a provider supplies only decoded messages. Add contract tests using anonymized source examples, retries, backoff, quarantine, and bounded backfill.

## Stage 4 — positions and map reads

A separate position adapter, observations with timestamps and provenance, stable aircraft identity, and a map read model. The first map version may fetch a coherent snapshot over HTTP. Flight history and position freshness do not depend on the presence of radio messages. The frontend keeps the agreed minimal design: map, list, details, and clear statuses.

## Stage 5 — visibility and incremental updates

Enforce publication scope before deriving aircraft counts and colors. Add entitlement and grant revisions, contribution retractions, and tests that hidden messages do not leak their existence. Then implement snapshot + replay + an `upsert/remove` stream, subscription generations, scope-bound cursors, and recovery after disconnection.

## Stage 6 — domain expansion

Message→FlightSession correlation independent of Message→Aircraft, reassembly, multiple stations, different protocols, history, geographic filters, telemetry, and justified indexes. Introduce a broker and separate processes when measured traffic and isolation needs warrant them. They are not prerequisites for implementing the domains.

## Public deployment readiness

Replace the explicit demo mode with durable storage and access-control ports, enforce resource limits, handle source failures, establish publication rights, and add integration tests. Limitations of the in-memory demonstrator must not be presented as production guarantees.
