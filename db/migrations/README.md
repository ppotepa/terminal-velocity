# PostgreSQL migrations and test isolation

These migrations implement the durable synthetic Stage 2 message flow and the private, append-only Stage 4 position-history storage boundary. The larger DDL under `docs/architecture/persistence` remains a design reference. It is not executed by the application.

## Ownership and application permissions

Each schema has its own `NOLOGIN` owner: `tv_ingestion_owner`, `tv_correlation_owner`, `tv_delivery_owner`, `tv_availability_owner`, and `tv_tracking_owner`. The `tv_runtime` permission role also has `NOLOGIN`. A separately provisioned application login inherits that role; it must not be a member of any owner role. Migrations reject unexpected privileged role attributes and inherited memberships when accepting existing roles.

The runtime can insert and read immutable messages, decisions, position observations, and outbox events. It can update the current decision head, delivery state, and availability contributions. Only `fanout_completed_at` is updateable on a correlation outbox event. Position history and its outbox have no runtime update or delete grants. Runtime grants do not include DDL or deletion. All tables are addressed through qualified schema names.

Migrations require an administrative connection that can create roles and schemas and set the schema owner roles. Run them as an explicit deployment step:

```sh
MIGRATION_DATABASE_URL='postgresql://<migration-login>:<password>@<host>/<database>' npm run db:migrate
```

The API never runs migrations. The migration runner uses one transaction, an advisory lock within the target database, and SHA-256 checksums recorded in `tv_migrations.applied`. A second unchanged run does nothing. A changed or missing migration fails. Cluster-wide role creation tolerates a concurrent creator and then validates the resulting role. Once a migration has been deployed, add a new numbered file instead of editing the applied file. There is no automatic destructive down migration.

## Local application database with Docker Compose

The optional Compose service uses PostgreSQL 18.7, binds only to loopback port 55432, and retains its data in a named volume. Its default password is a synthetic local development value. It is not a production credential.

```sh
docker compose up -d --wait postgres
export MIGRATION_DATABASE_URL='postgresql://tv_local_admin:synthetic-local-admin-only@127.0.0.1:55432/terminal_velocity_dev'
export RUNTIME_DATABASE_URL='postgresql://tv_local_runtime:synthetic-local-runtime-only@127.0.0.1:55432/terminal_velocity_dev'
npm run db:migrate
npm run db:local-runtime
```

`db:local-runtime` provisions only the `tv_local_runtime` login on that explicitly local development database. It requires the role to be absent and does not rotate an existing password. Pass the runtime URL to the application as documented in the project startup guide. Keep the administrative URL out of the application configuration.

## Real PostgreSQL integration tests

The normal unit test command has no database requirement. The integration command intentionally fails when its database configuration is missing; it never silently skips the SQL checks.

For an explicitly isolated loopback test server, provide an administrative login and bootstrap database whose names start with `tv_test_`:

```sh
TEST_DATABASE_URL='postgresql://tv_test_admin:<test-password>@127.0.0.1:5432/tv_test_bootstrap' npm run test:integration
```

The runner creates a fresh `tv_test_<random>` database, runs migrations, and creates a fresh restricted runtime login. It passes separate admin and runtime URLs plus the exact generated database name to the tests. Fixture cleanup requires that exact name. After tests finish, the runner removes only the database and login it created. URL query strings and fragments are rejected because connection options could override the validated target or credentials. Use this helper only with an ephemeral test server; creating application owner roles is cluster-wide.

On a machine with PostgreSQL binaries available, the complete suite can create and remove its own private server:

```sh
PG_BIN=/path/to/postgresql/bin npm run test:postgres:local
```

`PG_BIN` can be omitted when `initdb` and `postgres` are on `PATH`. `PG_SHARE_DIR` optionally identifies the server's share directory for an unpacked distribution. `TV_PG_WORK_DIR` optionally chooses a writable location for temporary cluster data. PostgreSQL must run as an unprivileged OS user. The launcher keeps `fsync`, `synchronous_commit`, and `full_page_writes` enabled, starts the server on a fresh loopback port, runs the integration suite in the same process environment, and stops and removes its own cluster afterward. No server binaries are downloaded by the repository scripts.

GitHub Actions uses an ephemeral `postgres:18.7` service and runs the integration command as a required workflow step. This configuration is distinct from a recorded successful CI run.

## Guarantees covered

The suite exercises independent-process first-write contention, revision CAS, atomic decision/outbox writes, SQL rollback and capability lifetime, late-committing outbox records, `SKIP LOCKED` queue claims, lease token fencing, recovery, bounded retries, consumer-specific inbox deduplication, atomic projection rollback, contribution correction and tombstones, runtime grants, and migration drift. Application integration tests also restart the actual API process and read persisted state.

The position table uses PostgreSQL's built-in `point` value with a GiST index; no PostGIS extension is required. Position history is keyed by `(source_id, source_observation_id)` and stores the canonical JSON fact so omitted, null, and zero optional fields remain distinct. Its generated ICAO24 hint is only a search hint; the temporal identity registry is added later. The history adapter can insert synthetic test observations, but S4-03 does not connect the live adsb.lol source to durable storage. ADR #0002 keeps real position-row retention gated on issue #46.

The implemented message projection serves one fixed synthetic public scope. This schema does not implement multi-tenant authorization, real receiver ingestion, a broker, or the complete architecture catalog.
