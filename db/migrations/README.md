# PostgreSQL migrations and test isolation

## Migrations 008–010: temporal aircraft identity

`fleet_identity.aircraft` holds stable internal IDs. Assertions record normalized ICAO24 or registration, source, issuer, half-open validity interval, recording time, global revision, and optional predecessor. Corrections append successors; old rows remain evidence. Overlapping owner claims remain ambiguous, while disagreeing identifiers remain conflicted. Readers use observation time and report completeness explicitly. Correlation consumes complete candidate snapshots through its existing port.

Each assertion append atomically advances the registry revision and writes replay requests for the new and corrected validity ranges. The private replay worker scans ICAO24 position hints and affected messages in bounded, keyset pages, appending position-link and correlation decision revisions. Migration 009 adds durable phase and cursor progress. Migration 010 adds a position-link job queue and a trigger that enqueues each newly inserted observation in the same transaction as its fact and outbox. It does not scan older position rows during migration. After migration, run `npm run db:backfill-position-links` with `MIGRATION_DATABASE_URL` for an existing database. That command scans at most 500 keys per transaction, queues only unlinked facts, and commits its cursor with each batch. Repeated runs resume safely; concurrent new inserts are already covered by the trigger. Keep the older worker active until the progress row has `completed_at` and pending jobs have drained. Its scheduler row alternates between new-position jobs and correction requests so either class progresses under a continuous feed. The worker uses the same transaction connection for the page, decision, scheduler turn, and progress update, including with a one-connection pool. Failed work retains its pending job or cursor and rolls back the turn. Observation facts and prior link revisions remain immutable. Registration-only requests apply to message correlation because positions have no registration hint index. The migrations are additive and have no destructive down migration; application rollback must retain the new tables and history.

These migrations implement the durable synthetic Stage 2 message flow, private Stage 3 delivery metadata, and private append-only Stage 4 position history. The larger DDL under `docs/architecture/persistence` remains a design reference. It is not executed by the application.

## Ownership and application permissions

Each schema has its own `NOLOGIN` owner: `tv_ingestion_owner`, `tv_correlation_owner`, `tv_delivery_owner`, `tv_availability_owner`, `tv_source_ingestion_owner`, and `tv_tracking_owner`. The `tv_runtime` permission role also has `NOLOGIN`. A separately provisioned application login inherits that role; it must not be a member of any owner role. Migrations reject unexpected privileged role attributes and inherited memberships when accepting existing roles.

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

The position table in migration 007 uses PostgreSQL's built-in `point` value with a GiST index; no PostGIS extension is required. Position history is keyed by `(source_id, source_observation_id)` and stores the canonical JSON fact so omitted, null, and zero optional fields remain distinct. Its generated ICAO24 hint remains a search hint; migration 008 links facts through separately versioned decisions. The history adapter can insert synthetic test observations, but S4-03 does not connect the live adsb.lol source to durable storage. ADR #0002 keeps real position-row retention gated on issue #46.

The implemented message projection serves one fixed synthetic public scope. This schema does not implement multi-tenant authorization, real receiver ingestion, a broker, or the complete architecture catalog.
The implemented projection serves one fixed synthetic public scope. This schema does not implement multi-tenant authorization, real receiver ingestion, a broker, or the complete architecture catalog.


## Migration 002 and the S3-04 storage contract

`002_source_deliveries.sql` creates the private `source_ingestion` schema. A scoped delivery key consists of the configured source, provider, account, source epoch and opaque external ID. The synthetic adapter supplies stable keys. A later provider adapter must establish the same guarantee before using its IDs. An insert collision raises PostgreSQL `23505`. S3-04 owns classifying replays and conflicts under concurrency.

The delivery row records a digest, level, schema/decoder/capability versions, receipt and optional observation clock evidence, retrieval and ingestion times, and disposition with a quarantine reason when applicable. Provenance contains a parser version and a page URL stripped of credentials, query and fragment (credential-bearing URLs are rejected). Callers supply a public-safe page path. `METADATA_ONLY` excludes raw pages, decoded text and frame bytes. Source/time and partial quarantine indexes support bounded scans. Issue #6 still gates retaining real provider data.

`postgresSourceDeliveryStore(executor)` inserts the delivery and optional provider direction/bearer or receiver ID/frequency/signal facts in one SQL statement. A lookup by scoped key returns those facts. Composite foreign keys enforce each detail table's data level. S3-04 can supply a transaction-bound executor and append a source outbox event in that transaction. The outbox has a separate event ID, a delivery-scoped stream revision, a reference-only payload and a fanout marker. Stage 2 consumer deliveries still reference the correlation outbox. S3-07 owns the consumer bridge.

Rollback of the application can leave the additive schema in place. Preserve migration history and use a follow-up migration for any schema changes.

## Migration 003 and source acceptance

`acceptSourceDelivery` takes an operator-verified source scope and capability declaration separately from a v1 observation envelope and retrieval provenance. The PostgreSQL adapter locks the complete scoped key before reading under READ COMMITTED. A new delivery, its detail facts and the revision-1 source outbox event commit on one checked-out connection. Callers receive the durable delivery ID and first retrieval provenance only after commit. There is no HTTP endpoint or automatic import into correlation.

Migration 003 adds `canonical_v1_sha256` to the source outbox. The v1 fingerprint is SHA-256 over a UTF-8 domain prefix (`source-acceptance-v1` followed by a NUL) and JSON encoding of `[parserVersion, validatedObservation]`. Object keys sort in ascending code-unit order at each level, arrays preserve order, and the observation uses the #5 contract's normalized times and identifiers. The provider digest remains an independently supplied fact. Page location, retrieval time and ingestion time describe the first sighting. A retry from another page or time can match that sighting. Original bytes, frame contents and decoded message text are excluded from persistent storage.

For `DUPLICATE`, return the original receipt. For `CONFLICTED`, preserve the existing row and event. A pre-003 or storage-only delivery without a matching fingerprint cannot prove equivalence and yields a conflict. Invalid source scope, capability revision, level, envelope or provenance fails before SQL. An unavailable database or uncertain commit outcome yields `UNAVAILABLE`; retry with the same source key and canonical facts.

The event type is `source.delivery-accepted.v1`, its stream key is the delivery UUID, its revision is 1 and its JSON payload is `{"deliveryId":"<uuid>"}`. For S3-07 the proposed consumer identity is `source-message-import.v1`, with inbox deduplication on (consumer identity, event ID). A receipt proves acceptance only. S3-07 owns that inbox and the import transaction.

An application rollback can leave the additive nullable column in place. Preserve recorded fingerprints and the existing migration ledger.

## Migration 006 — source replay checkpoints

`source_ingestion.replay_checkpoints` stores one current replay range, opaque
cursor, attempt/budget counters, redacted quarantine and health per exact source
scope. Runtime can select, insert and update; it cannot delete. The existing
source owner owns the table. There are no raw payload columns and no changes to
message visibility. Cursor data remains private. Receipt/outbox transactions are
unchanged; checkpoint advancement follows receipt commit so a lost acknowledgment
repeats idempotent acceptance. See [source operations](../../docs/SOURCE_OPERATIONS.md)
for concurrency, bounded review and non-destructive rollback. Migration execution
is coordinator-verified in the isolated PostgreSQL suite, never by API startup.

## Migration 007 — private tracking history

`007_tracking_position_history.sql` follows the Stage 3 source migrations. It creates `tv_tracking_owner` and `tracking`, a source-scoped append-only observation table, and a producer outbox. The runtime role receives only `SELECT` and `INSERT` on these tables. Canonical JSON facts retain optional field presence while generated ICAO24 is only an unconfirmed search hint. Observed and ingestion times have distinct columns. Source delivery references are optional and opaque; they do not imply a foreign key to a permitted provider delivery. A unique source observation key and one event per fact make retries idempotent. Different sources retain independent facts. The application writer inserts both rows in one checked-out transaction. An outbox failure rolls back the observation.

Coordinates use finite, bounded longitude and latitude validated by the application and database. PostgreSQL's built-in `point` and GiST index support private spatial bounding-box queries, with a split range when west exceeds east across the antimeridian. The time and ICAO24 indexes support bounded, deterministic keyset history. No extension or persistent service is installed by this migration. A rollback requires a new migration; do not edit an applied checksum or delete retained facts as an application rollback.

## Migration 011 — fleet correction authority

`011_fleet_identity_correction_authority.sql` rejects a successor assertion whose `source_id` or `issuer` differs from the assertion it supersedes. It first fails migration if prior cross-authority corrections already exist, so those histories must be reviewed rather than silently accepted. The insert trigger covers direct SQL writers as well as the application committer. Independent conflicting claims remain separate current assertions and resolve ambiguously; a source cannot erase another source's claim by naming its assertion ID. This migration changes no existing assertion, link, or replay row and has no destructive down migration. A rollback of application code must retain this correction guard and the append-only history; altering the schema requires a forward migration.

## Migration 013 — atomic fleet registry writes

`013_fleet_identity_registry_write.sql` removes the runtime role's direct assertion insert and registry revision update grants. The role calls `fleet_identity.append_assertion` to append a validated row, advance the global revision, and enqueue affected alias and aircraft expansion work in one transaction. The function serializes writers on the registry state row and checks correction authority again after acquiring that lock. A failed insert or correction rolls back its revision and replay work. Existing assertions and replay history are retained. Runtime replay workers keep the narrow replay-request insert grant needed to expand already committed work.

Identity reads page bounded decision evidence by assertion ID. It keeps at most two distinct active aliases of each kind per matching aircraft; duplicate claims and further conflicting values remain in paged assertion history. Each page reads the registry revision; a revision change while paging returns an incomplete snapshot so correlation cannot confirm an aircraft from mixed registry versions. The 2,000-row decision-evidence ceiling can still return `PARTIAL` for very large owner sets. Application rollback must retain migration 013 or use a new forward migration restoring a safe writer; direct insert cannot be re-enabled without a revision and replay mechanism.

## Migration 014 — incomplete correction replay

`014_fleet_identity_replay_blocked.sql` adds a `BLOCKED` request phase and the registry revision that caused an incomplete candidate lookup. The worker skips that request so later correction requests can advance. It retries the blocked request after the registry revision changes. The cursor and immutable message, assertion, and decision histories remain intact. An application rollback must retain this phase or use a forward migration that safely handles blocked requests.


## Migration 015 — fair identity replay scheduling

`015_fleet_identity_fair_scheduler.sql` extends the existing scheduler
with a separate `EXPANSIONS` work class. On each committed page the worker
rotates the preferred queue from `JOBS` to `EXPANSIONS` to `CORRECTIONS`
and back, starting after the class that actually completed. Empty classes
are skipped without losing progress; the scheduler row and selected page
remain in the same transaction. Under continuously nonempty queues,
every class is serviced at least once in three committed turns. This
migration preserves previous state values and all durable pending work.
