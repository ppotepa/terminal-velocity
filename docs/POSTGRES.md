# PostgreSQL storage — Stage 2

PostgreSQL mode makes the existing synthetic message flow durable. It uses the same HTTP routes and fixture aircraft as memory mode. Message facts, correlation history, outbox work, consumer receipts, and availability contributions survive API restarts. Real source ingestion, publication permissions, and a map remain later roadmap stages.

## Start the local development database

Requires Node.js 24.x, npm, and Docker Compose. From the repository root:

```bash
npm ci
docker compose up -d --wait postgres

export MIGRATION_DATABASE_URL='postgresql://tv_local_admin:synthetic-local-admin-only@127.0.0.1:55432/terminal_velocity_dev'
npm run db:migrate

export RUNTIME_DATABASE_URL='postgresql://tv_local_runtime:synthetic-local-runtime-only@127.0.0.1:55432/terminal_velocity_dev'
npm run db:local-runtime

export STORAGE_DRIVER=postgres
export DATABASE_URL="$RUNTIME_DATABASE_URL"
npm start
```

The example passwords are only for the loopback development database. If you set `TV_LOCAL_ADMIN_PASSWORD` for Compose, use the same value in the migration URL. Provision the runtime login once; `db:local-runtime` deliberately refuses to overwrite an existing login or rotate its password. On later starts, reuse its existing credentials and run only the commands required for migrations and API startup.

In a second terminal, run `npm run example`. If the API uses a custom `PORT`, export the same value in that terminal. The client creates and replays one synthetic message and waits briefly for its availability projection. `GET /healthz` reports `mode: "demo"` and `storage: "postgres"`. It checks database connectivity, not queue progress or projector health. The API binds to `127.0.0.1`; `PORT` defaults to `3000`.

The named Compose volume preserves data when the container stops. The API never starts a database, applies migrations, or provisions roles automatically. Environment variables must be exported in the process launching `npm start`; `.env` files are not loaded by the API.

## Migrations and ownership

`npm run db:migrate` requires `MIGRATION_DATABASE_URL` with administrative privileges sufficient to create the designated roles and schemas and to set schema ownership. The initial migration creates these ownership boundaries:

| Schema | Owner role | Stored responsibility |
|---|---|---|
| `message_ingestion` | `tv_ingestion_owner` | Immutable canonical synthetic message facts |
| `correlation` | `tv_correlation_owner` | Decision history, current heads, and producer outbox |
| `event_delivery` | `tv_delivery_owner` | Delivery attempts, fenced leases, quarantine, and consumer inboxes |
| `source_ingestion` | `tv_source_ingestion_owner` | Private delivery metadata, optional provider/reception facts and a source-owned outbox |
| `availability` | `tv_availability_owner` | Versioned contributions and retraction tombstones |

Owner roles and the `tv_runtime` permission role are `NOLOGIN`. The separately provisioned runtime login inherits the explicit table/column grants assigned to `tv_runtime`. It does not own the application schemas or receive permission to create or alter objects in them, and it cannot update immutable messages, decision history, or outbox payloads. In this one-process stage, the same runtime role has the narrow grants needed by both producer and consumer adapters. Separate production process identities and tenant authorization are later work.

The migration runner uses one checked-out connection, an advisory lock, a transaction, and SHA-256 checksums recorded in `tv_migrations.applied`. Reapplying unchanged migrations is a no-op. A changed applied migration or a migration missing from the checkout is rejected. Add a new migration instead of editing an already-applied one. The historical `docs/architecture/persistence/REFERENCE_DDL.sql` is not executable application schema.

## Transaction boundaries

| Transaction | Atomic contents | Failure/retry behavior |
|---|---|---|
| Ingestion | Immutable message facts, a consecutive decision revision, current head, producer outbox event | A per-message transaction lock serializes first writes before reading the head. Identical replay returns the stored message; conflicting facts return HTTP 409. |
| Fan-out | Every configured consumer delivery and the producer outbox fan-out marker | A rollback leaves the event eligible for another fan-out attempt. |
| Consumption | Consumer inbox receipt, availability contribution, delivery acknowledgment | A projector error or expired lease rolls back the receipt and effect together. Another attempt can retry. |

The transaction helper retains one connection through `BEGIN`, work, and `COMMIT`/`ROLLBACK`. It rejects SQL use after the callback, swallowed statement failures, and callbacks that return with SQL operations still in flight. Decision transactions additionally enforce read-before-write, consecutive revisions, and a matching outbox event for each write. These choices follow the [node-postgres transaction contract](https://node-postgres.com/features/transactions) and PostgreSQL's [transaction-level locking rules](https://www.postgresql.org/docs/18/explicit-locking.html).

If a connection disappears while the server is committing, the client may not know whether the commit succeeded. Retry the same immutable message ID and facts to resolve that uncertainty. A client error alone does not prove that a commit was rolled back.

## Delivery and availability

The current consumer is `demo-availability-v1`. Its configured fan-out consumer set is fixed for this stage. Adding a consumer later requires an explicit generation/backfill strategy; changing the list does not replay already-fanned-out events automatically.

Queue claims use bounded batches and `FOR UPDATE SKIP LOCKED`. A lease has a new UUID token, a database-clock expiry, and an attempt count. Consumption checks token and expiry before projection and again during the final acknowledgment update. An expired or superseded lease detected at either check prevents the effects from committing. The delivery row remains locked through transaction completion; the lease is not a deadline on the database's commit acknowledgment.

The application worker polls after each completed batch, with an idle interval of 250 ms. It uses 30-second leases, processes at most 100 items per batch, and schedules exponential retries from one second up to 60 seconds. Eight unsuccessful attempts exhaust the default budget. Expired leases can be recovered after restart; exhausted or permanently conflicting events remain `QUARANTINED` for inspection. Quarantine is durable and is not automatically replayed. Failures are logged with a generic message; payloads and connection credentials are not logged.

Inbox identity is `(consumerId, eventId)`, plus a digest of the immutable event envelope. Duplicate content is acknowledged without repeating effects. Reusing an event ID with different content is an identity conflict. Deduplication covers SQL effects in the same database transaction; arbitrary external network calls are outside that atomic boundary.

The projector reads immutable message facts for observation time and bearer. It writes higher contribution revisions, ignores older ones, and retains all-null tombstones after retraction. Equal revisions with conflicting facts fail. Correcting an A→B decision removes A's contribution and adds B's; A can fall back to an older eligible message. Freshness is evaluated on reads from observation time, so importing historical data does not make it recent.

The visibility scope is permanently synthetic in this stage. Decision revision is the contribution revision only because no independent publication/grant changes are accepted. This mapping must not be reused for real publication controls without an authoritative publication/contribution revision. Both storage modes continue to report `coverage: "UNKNOWN"` and `feedHealth: "DISCONNECTED"`.

HTTP 201 means the ingestion transaction has committed. Message reads are immediately available; aircraft availability may lag until consumption succeeds. The example client tolerates that delay. Durable storage has no 500-message lifetime cap, but one aircraft's message list returns at most the 500 newest messages. Pagination, automated retention, public access controls, backup operations, and a correction HTTP endpoint remain unimplemented.

## Run integration tests on real PostgreSQL

The suite intentionally fails when database setup is missing. It does not substitute an in-memory database or silently skip integration tests.

With PostgreSQL binaries installed for an unprivileged user:

```bash
npm run test:postgres:local
```

Set `PG_BIN` to the directory containing `postgres` and `initdb` if they are not on `PATH`. `PG_SHARE_DIR` supports an extracted distribution, and `TV_PG_WORK_DIR` selects a writable parent directory. The harness creates a temporary cluster, keeps `fsync`, `synchronous_commit`, and full-page writes enabled, runs the tests, and removes only that temporary cluster. It starts the server and test subprocesses together, which also works in environments with isolated process namespaces.

Alternatively, supply an explicitly isolated loopback bootstrap database and administrative login whose names both start with `tv_test_`:

```bash
export TEST_DATABASE_URL='postgresql://tv_test_admin:your-test-password@127.0.0.1:5432/tv_test_bootstrap'
npm run test:integration
```

That bootstrap login must be able to create a disposable database and roles and run the full migration, including `SET ROLE` to the designated schema owners. Use an isolated test instance: the runner removes its random database and restricted runtime login afterward, while the migration-created fixed `tv_*` owner and permission roles remain in an externally supplied cluster. Test URLs with connection-overriding query parameters are rejected. CI uses a dedicated PostgreSQL service for the same suite.

The suite exercises competing first writes, stale revisions, outbox failure rollback, transaction capability lifetime, fenced lease recovery, inbox deduplication, projector rollback, revision collisions, tombstones, observed-time freshness, schema privileges, and real API process restart. These are functional integration checks; they do not establish production capacity or simulate a host power failure.


### Source delivery bridge (migration 004)

Migration 004 replaces the correlation-only delivery FK with an immutable
producer registry, preserving existing event IDs and queued deliveries. It also
adds explicitly synthetic normalized input storage, provider message revisions,
immutable delivery/decision links, import quarantine receipts and a private
availability projection. The API does not apply this migration. Old dispatchers
must stop before applying it because they do not register newly emitted events.
See [the provider pipeline](PROVIDER_PIPELINE.md) for transaction/ACK boundaries,
lineage SQL and rollback limitations. The integration suite includes an upgrade
from a populated Stage2 database and consumption of its previously queued event.
Its execution remains pending in the #11 local handoff; no hosted migration or
backup/recovery operation has been performed.
