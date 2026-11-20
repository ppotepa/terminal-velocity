# Terminal Velocity — implementation status, Stage 2

### S4-04 temporal fleet identity (issue #17, local authoring)

The private fleet identity context provides stable internal aircraft rows, time-qualified ICAO24 and registration assertions, explicit ambiguous, conflicted, and incomplete resolution, a complete candidate directory adapter for message correlation, and versioned position links separate from immutable observation facts. Migration 008 adds append-only assertion and link history plus replay requests. Migration 009 adds durable per-request replay progress. Migration 010 adds jobs for new position facts and backfills jobs for existing facts without link decisions. The permitted provider pipeline can use a transaction-bound registry directory when no fixture directory is supplied. Its drain consumes correction requests in bounded, locked keyset pages, re-evaluates ICAO24 position hints and ICAO24 or registration provider messages at observation time, and appends message decision/outbox revisions without rewriting source facts. Assertion changes enqueue overlapping aliases of both affected aircraft so a message using an unchanged alias is re-evaluated. Position resolution vetoes simultaneous distinct values of one identifier kind for an aircraft, matching the message correlation rule. A failed page retains its cursor; repeated position work is idempotent. The on-demand rendered Airframes lookup remains separate.

Local verification and coordinator exact-SHA PostgreSQL evidence belong in the #17 handoff. This code does not assert provider rights or external acceptance. Migrations 008–010 are additive; rolling back application code leaves assertion, decision, job, and replay history in place. The worker is invoked by the permitted pipeline drain and is bounded to 100 pages per call; an operator must call drain again if more pages remain. It does not introduce live-provider retention rights, a public map, or flight-session recognition.

The coordinator's isolated CI for `c468592623c34eacfc1732237a67880656805d8e` passed `npm ci`, `npm run check` (189 backend and 30 API tests), 105 PostgreSQL integration tests, demo, smoke, 41 message-browser tests, and 26 browser tests. Review then found that a reader failure escaped the public resolution contract and continuous position jobs could postpone correction replay. The subsequent code returns `INCOMPLETE/LOOKUP_FAILED` with an unknown revision represented as zero and uses a durable alternating work-class turn in migration 010. The exact-SHA result for that correction is recorded in issue #17 and its PR rather than inferred from this earlier CI run.

Registry-backed imports hold a shared registry-state lock through the source transaction so a correction cannot finish replay ahead of an older decision's commit. Replay cursors are advanced only after a page succeeds. Message replay writes a new correlation decision and outbox event; the permitted drain routes and projects that event after replay, within its bounded work budget. An explicitly supplied fixture directory does not run registry correction replay. Migration 009 grants only cursor-column updates to the runtime role and adds indexes for alias/time message scans. Schema reversal would require a separate history-preserving migration.

Date: November 19, 2026. Code version: `0.1.0`. The application offers a durable PostgreSQL mode for one complete synthetic message flow, alongside the original memory demonstration. Stage 3 includes source-observation contracts, on-demand website lookup, and private delivery metadata storage exercised with synthetic inputs.

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

Stage 4 now has private synthetic position history and temporal aircraft identity. New position facts enqueue a durable identity-link job in their write transaction; the private replay worker processes jobs and alias corrections through the registry on one transaction connection. Position projection and UI remain unimplemented. S4-02 adds an opt-in private adsb.lol adapter, but no live result is persisted or publicly served. Messages are decoded text examples, not captured RF frames. No real Airframes message connector, moving map frontend, flight sessions, reassembly, entitlement enforcement, or public deployment has been added.

The architecture v2 catalog still describes 89 intended responsibilities rather than 89 completed services. Stage 3 has a separate on-demand lookup and durable metadata store. Real-source retention and a permitted provider fixture remain gated by issue #6. Its source contracts do not grant publication rights. The historical DDL and target event envelope remain design documents; the implemented schema is under `db/migrations`, and the current event is `correlation.aircraft-decision-revised.v1`.

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

The selected source is the rendered Airframes Live Messages website. The on-demand CLI reads matching rendered cards for one ICAO24. The API strategy reports unavailable. The crawler is separate from durable ingest and the future map UI. Issue #6 remains blocked pending evidence for the intended website collection, retention and use of a redacted sample. The application FAQ covers general hobby use. See the [source decision](adr/0001-first-message-source.md) for the website evidence and exact outstanding questions.

## Stage 3 delivery storage — S3-03

Migration 002 adds restricted source deliveries, provider-message facts, receiver receptions and an independent source outbox. The typed SQL store records and reads metadata from synthetic observations, with separate clocks for observation, receipt, retrieval and ingestion. Raw payload and decoded text are excluded. The lookup CLI does not write to this store. See the [migration contract](../db/migrations/README.md#migration-002-and-the-s3-04-storage-contract).

## Stage 3 atomic acceptance — S3-04

The source acceptance use case validates a synthetic observation against an independently configured source scope and capability revision, then commits delivery metadata and one source outbox event together. Matching retries return the original delivery ID and provenance. A changed canonical fact under that key produces a conflict. The lookup CLI, public API and Stage 2 consumer operate separately. See the [acceptance contract](../db/migrations/README.md#migration-003-and-source-acceptance).

## Stage 3 bounded source transport — issue #9

The private messages CLI exercises one scoped Airframes rendered-page window with an offline synthetic browser fixture. The backend connector bounds page retries, pending deliveries and bytes, reports health independently of coverage, and drains pending acceptance on stop. The source handler accepts a parser and the existing #8 transaction. Both CLI previews use an inspector. Durable runs require a committed receipt per delivery. Each DOM sample checks page scope, and Chromium owns the socket handshake. A refused upgrade ends that lookup even when Chromium withholds the status or cooldown. A disconnect after acceptance can start another bounded attempt. The browser suite exercises these paths and cancellation against a synthetic loopback TLS peer. The private one-shot lookup allows bounded first-party bootstrap and socket traffic for the rendered page. It returns transient matching cards and reports partial layouts and truncated windows with the validated cards that fit the preview budget. Recurring collection and real-content retention are rights-blocked, and API selection returns unavailable. The public API and database schema have no changes in this issue. See [source operations](SOURCES.md#private-on-demand-page-transport).

## Issue #10 — synthetic normalization engineering

A strict versioned extracted-record parser and pure normalizer now retain immutable
source provenance, independent clock evidence, validated identifier hints, aircraft
participant roles, declared data level and separate bearer/application protocol.
The rendered-card adapter maps displayed optional fields and treats feeder labels
as provenance, never as invented receptions. Schema drift, invalid clocks,
conflicting hints and incompatible layouts fail explicitly. Synthetic golden
regressions cover text-only layout drift and mixed recognized/incompatible records;
the scroller reader checks content outside recognized cards even when cards exist.
Cards with multiple distinct message paths or multiple visible bodies are rejected
as `PARTIAL_LAYOUT`; duplicate links to one path remain valid. Immutable provenance
also retains original registration spellings per participant alongside the
normalized aircraft hint, including through JSON serialization.
Fractional rendered UTC timestamps with one to three digits retain `MILLISECOND`
precision after ISO normalization, with declared uncertainty unchanged. Synthetic
fixtures and a browser-to-normalizer regression are included in existing root
verification entry points. No SQL, demo API, source rights or retention policy
changed. The provider API remains inactive.

The baseline upgrade integration test now waits for PostgreSQL client disconnects
before removing its disposable database. Deterministic lifecycle regressions run
in `npm run check`; the coordinator must verify the database teardown correction
in the unprivileged exact-SHA integration runner.

This is not a verified real Airframes format: optional markup and all records are
fabricated fixtures. Permitted real-sample acceptance is blocked under ADR 0001.
See [the issue #10 handoff](handoffs/issue-10.md) for exact local checks, environment
failures and coordinator-owned verification. No remote CI or merge is claimed.


## Issue #11 engineering update (November 19, 2026)

The worktree adds the [private provider pipeline](PROVIDER_PIPELINE.md): migration
004 bridges source/correlation producers into a durable registry; source imports
atomically record inbox, immutable provider message revision, all source delivery
links, correlation and outbox; a separate consumer projects private availability.
Migration 005 replaces the synthetic-only retained-input restriction with explicit
permission scoped to source/provider/account/epoch. The normal permitted-provider
composition reuses #10 normalization and existing correlation policies; its
synthetic helper is retained. Permission evidence stays immutable with lineage.
Tests use synthetic content, including a non-synthetic provider namespace. Demo REST records, counts and availability remain separate.
The actual rendered Airframes lookup and metadata-only live acceptance remain in
place. No provider rights, retention permission, public disclosure or deployment
is inferred from synthetic fixtures.

Verification is **partial**: 165 database-independent tests pass, including 12
import tests and 3 retention permission tests, with Node 24.22.3. Type checking and boundaries pass. Real
PostgreSQL verification is blocked because this shell is root; API/smoke and
browser execution encounter sandbox restrictions. These results do not replace
remote/exact-SHA CI. See [the issue #11 handoff](handoffs/issue-11.md) for command
results, unverified acceptance items and migration/replay notes. The issue is not
DONE and no later engineering issue was started.

### Issue #11 rendered acceptance review revision

The permitted pipeline now exposes `acceptRendered(PageDelivery, context, scope)`
through its normal composition. It uses the rendered normalizer and the shared
permission-checked acceptance transaction, deriving page provenance internally.
PostgreSQL regressions exercise the connector callback, private correlation/status,
lineage, restart, later-clock replay and rejection without retained effects.
Fresh execution results and environment limitations are recorded in
[the issue #11 handoff](handoffs/issue-11.md). Airframes previews remain transient;
the provider API remains inactive and actual retention rights remain an external gate.

## Issue #12 — bounded replay engineering

The canonical checkout adds scoped replay checkpoints (migration 006), deterministic
retry planning, independent fetch/parse health, redacted durable quarantine and
local synthetic administrative commands. Each source scope serializes fetches;
reserved attempts and cooldown survive restart, and cursor advancement follows
existing durable acceptance. The explicit synthetic operator fixture now uses the
permission-checked provider pipeline through retained inputs, message import,
correlation and private availability. Provider cooldown survives quarantine and
manual review even after automatic retries are exhausted. Overlap reuses source idempotency and
preserves actual observed time. A partial page enters quarantine when a full-page
retry would exceed the remaining record budget, preventing a capped reader from
reporting completion before every record is accepted. The on-demand rendered Airframes lookup is unchanged,
real content is not retained by replay, and the API adapter remains inactive.

See [SOURCE_OPERATIONS.md](SOURCE_OPERATIONS.md) for limits, recovery, CLI commands,
health semantics and the private #13 handoff. The [issue #12 handoff](handoffs/issue-12.md)
records historical implementation-time local results; #12 engineering was merged
in PR #63 at `b04da88`. #11 engineering was merged in PR #62 at
`752aa27377abeb53f2042504116422f0ac5d86dc`; the older #11 execution notes
above are historical. Real-provider acceptance remains an external gate; this
change does not mark Stage 3 complete.

## Issue #13 — source validation gate

The [source integration runbook](SOURCE_INTEGRATION_RUNBOOK.md) defines the private
lineage and redacted evidence required for one authorized actual message. A new
PostgreSQL regression checks the synthetic delivery-to-private-read chain after
worker restart, duplicate replay, decode and time failures, unmatched aircraft,
and disconnection. This is engineering verification only. No authorized provider
sample, crawl and retention rights decision, measured source lag or actual
end-to-end latency is available; no real data has been retained. The source-derived
read port is internal and the unauthenticated demo HTTP API remains synthetic.
Stage 3 external acceptance and any source-derived HTTP read remain blocked.

## Stage 4 position contracts — issue #14 candidate

The `feature/s4-01-position-contracts` branch is based on the verified Stage 3
main. Its provider-neutral position boundary records source and aircraft identity,
measurement kind, coordinates, observed and ingested times, precision and uncertainty.
It validates the supplied source capability and rejects inconsistent adapter
results. It requires ICAO24 or an upstream confirmed aircraft ID, retains
simultaneous barometric and geometric altitudes under schema v1, and uses
precision when classifying position freshness. Position freshness is independent of radio-message availability.
Confirmed IDs now require a resolver-scoped evidence reference and a separate
upstream decision bound to the source delivery, with conflicting ICAO24 and
evidence claims rejected. See [POSITIONS.md](POSITIONS.md)
for the contract and limits. Independent review and merge remain before #14
is accepted. There is no migration, persistent position
state or concurrency change. Before consumers adopt schema v1, rollback is
removal of the contract and its export. No live position source, storage, map,
source rights or deployment is claimed here.

For an earlier identity fix in this checkout, Node 24.22.3 ran
`npm ci --offline --ignore-scripts --no-audit --no-fund`, the position contract
suite, type checking, architecture checks (225 source files, 809 dependency
edges), and backend workspace tests successfully. `git diff --check` passed.
The full `npm run check` reached the API workspace but failed because this
shell denies loopback binds (`listen EPERM` on 127.0.0.1); it is not a passing
full-suite result. The coordinator's isolated local CI passed at
`91b3ff353aac9e04a217cf793ca2df91c6641408`. The coordinator also supplied
passing isolated local CI for the position-contract changes at
`5b8881052f4923f5386598c3c2d3e1986449d07f`. Commit `5a4bcfe` changes
only this status document. PR merge and merged-SHA verification remain pending;
no hosted CI or deployment success is claimed here.

For the altitude and identity-evidence review changes, Node 24.22.3 ran
`npm ci --offline --ignore-scripts --no-audit --no-fund`, the focused position
contract suite, `npm run typecheck`, `npm run check:boundaries` (225 source
files, 809 dependency edges), and `git diff --check` successfully. The backend
workspace tests passed during `npm run check`; API tests failed solely at
loopback binding with `listen EPERM` in this shell. The coordinator supplied a
passing isolated local CI log at committed SHA
`711ee6336ab27428fe44fb5119dc014bea9cf5db` for those changes. For the
later source-reference-time correction, Node 24.22.3 passed offline `npm ci`,
the focused position-contract suite, type checking, architecture checks, and
all backend tests. `npm run check` could not complete its API tests because this shell
denies loopback binds (`listen EPERM` on 127.0.0.1).

## Stage 4 private position source — S4-02

The `feature/s4-02-adsblol-position-source` branch adds an adsb.lol v2 point/radius parser and bounded HTTPS transport over the S4-01 observation contract. It maps age-derived timestamps, ADS-B/MLAT/other source types, coordinates, tagged altitude and track, optional measurements, ICAO ID hints, and source quality. Rows with only source-local IDs are counted as unresolved and omitted from canonical output. Snapshot coverage is explicitly sampled with unknown completeness. The transport has an 8-second timeout, 1 MB response limit, 50 NM radius cap, and a process-shared budget of one request per 10 minutes and 200 per rolling 24 hours. Its explicit poller honors `Retry-After`, uses capped exponential backoff, exposes separate transport health, and stops cleanly on abort. Creation alone never polls.

The source decision in [`adr/0002-position-source.md`](adr/0002-position-source.md) permits private/local use under ODbL 1.0 only. The explicit `positions:preview` command now composes the live adapter with a loopback-only, in-memory JSON preview; the demo API still does not start it. The live transport validates its query at construction and always uses the process-shared quota policy. An explicit fixture factory supplies an isolated budget for offline tests. The parser rejects out-of-query-area rows, and deliberately favors `SURFACE` over simultaneous numeric geometric altitude under schema v1. The fixture is synthetic; no database migration, public API/UI wiring, or persistent storage was added. Public use/deployment remains NO-GO pending Stage 5 publication controls and issue #46 licensing review.

The review follow-up routes positioned rows through the S4-01 `acceptPositionObservation` boundary with explicit reviewed source capabilities. Provider types or time bases outside that configuration reject the snapshot. Synthetic regression tests cover this boundary and malformed unit-bearing speed, track, altitude, and quality fields. These offline checks do not establish current provider access or rights acceptance for the reviewed commit; an authorized live check remains an external acceptance gate.

For this follow-up, Node 24.22.3 `npm ci --offline --ignore-scripts --no-audit --no-fund`, typechecking, the architecture boundary check, and all 17 backend test files passed. `npm run check` stopped in the private-preview suite because this shell rejects loopback `listen` with `EPERM` on `127.0.0.1`; the two tests that require a server failed for that reason. The preview's two argument-only tests passed. Exact-commit coordinator CI must run the full suite in its permitted isolated environment. No live provider request or rights recheck was performed in this follow-up.

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

S4-02 has no SQL change, so PostgreSQL was run as repository regression verification only. The ephemeral cluster bound to loopback and was removed by the harness; the system PostgreSQL service remains inactive. Manual source checks were two outbound HTTPS requests and opened no local listener. Issue #15 is IN REVIEW in [PR #57](https://github.com/ppotepa/terminal-velocity/pull/57), based on merged [S4-01 PR #56](https://github.com/ppotepa/terminal-velocity/pull/56) after reconciliation. Both GitHub Actions `verify` runs for commit `672d850` failed before any steps and provided no job logs; the exact cause is unknown. Local results are green; no remote CI pass is claimed. No deployment or public listener was started.

After reconciling merged S4-01, offline `npm ci` and the focused backend position tests passed. `npm run typecheck` and architecture boundaries passed. The full `npm run check` passed backend tests but API loopback tests could not bind in this shell (`listen EPERM`); coordinator CI must establish the exact-SHA result. No new live provider request was made in this handoff.

### S4-02 review follow-up (2026-11-20)

The review follow-up adds the explicit private preview entry point and offline
loopback test, constrains live transport construction and quota handling, adds
out-of-query-area and reconnect cases, and records the ground/geometric altitude
precedence. `npm ci --offline --ignore-scripts --no-audit --no-fund`, Node 24
`npm run typecheck`, `npm run check:boundaries`, and the focused provider suite
passed in this authoring checkout. `npm run check` reaches the new preview test,
but this shell rejects `listen(127.0.0.1)` with `EPERM`; the test is not marked
passing here. Coordinator isolated CI must run the exact head in an environment
that permits loopback. No live provider call, deployment, SQL migration, or
public listener was made for this follow-up. The private preview test uses only
the synthetic provider fixture. Rollback is a code revert; no database rollback
is needed. The source-rights decision remains repository-owner evidence, not
independent confirmation by this follow-up.

The subsequent review found that a message-crawler change associated CDP socket
events by URL. Multiple sockets can share that URL, so the change was removed
from the S4-02 diff; both crawler files again match merged S4-01. Node 24
offline `npm ci`, `npm run test:messages`, and the focused provider and position
contract tests passed after the removal. `npm run test:browser` could
not run to completion in this authoring shell because its synthetic loopback
server receives `listen EPERM` on `127.0.0.1`. The coordinator supplied a
passing isolated CI result for the corrected exact head
`e8e0d7ee27c81825a48d9af30173ffa3279871ab`. No new live provider request or independent
source-rights approval was obtained for this correction. The earlier
aggregate-only source smoke remains historical evidence, not a live acceptance
result for the corrected head.

The subsequent quota review removes the fixture factory's fetch-function input,
uses the real process clock for every live quota decision, and caps caller-supplied
timeout and response size at 8 seconds and 1 MB. The passing isolated CI result
above predates these edits; coordinator CI must verify their exact commit. No
live provider check was performed for this follow-up. There is no migration or
durable data change; rollback is a code revert and an in-memory preview is lost
on shutdown.

The supplied #15 issue body still labels its current status `BACKLOG` while
also recording PR #57 in review. The coordinator owns reconciling that issue
body and its status label; this checkout update does not change GitHub state.

For this quota follow-up, Node 24.22.3 passed offline `npm ci`, type checking,
architecture boundaries (232 source files, 832 dependencies), the focused
provider suite, all 17 backend test files, `npm run test:messages`, and
`git diff --check`. `npm run check` stopped at the private preview's loopback
test, and `npm run test:browser` also could not bind synthetic loopback servers:
direct execution showed `listen EPERM` on `127.0.0.1`. These are authoring-shell
results, not a passing exact-head isolated CI run.

### S4-02 response cancellation review fix (2026-11-20)

The coordinator supplied a passing isolated CI record for exact head
`1296a052764e718a8a9d70158fd32b2a83376adb`. Review then found that a
response stream with an unsettled `cancel()` promise could hold a timed-out
fetch or `poller.stop()` open. The transport now initiates reader cancellation
without waiting for the source to settle it. An offline regression uses a
stream whose cancellation never settles and checks timeout, caller abort, and
poller stop. This edit follows the tested head and needs a new exact-SHA CI run.

In the authoring shell, Node 24.22.3 passed offline `npm ci`, type checking,
architecture boundaries, all 17 backend test files, `npm run test:messages`,
and the focused provider suite. `npm run check` reached the private preview
test but could not bind loopback (`listen EPERM` on `127.0.0.1`); the browser
suite also failed in this shell. These are not exact-SHA CI results. No live
provider request was made for this fix. The historical aggregate-only provider
smoke predates both this edit and head `1296a052`; it does not establish live
acceptance for either. The issue body still says `BACKLOG` despite PR #57;
the coordinator must reconcile its body and status label and record the next
exact-head CI result. No migration or durable data changed. Rollback is a code
revert, and any in-memory preview is discarded on shutdown.

### S4-03 private position history implementation (issue #16, local authoring)

Migration `007_tracking_position_history.sql` adds the private `tracking` schema, an append-only observation table, and a producer outbox with restricted `tv_runtime` insert/select grants. Source-scoped observation keys distinguish retries from independent measurements. A retry with changed canonical facts conflicts; a new fact and its event commit on one transaction. The stored source delivery reference is optional and opaque. Observed and ingestion times remain separate, and ICAO24 is a search hint rather than a confirmed aircraft assignment.

The history reader validates a 31-day maximum time window and 500-row maximum page, orders by observed time and source key, and uses keyset pagination. PostgreSQL built-in `point` with a GiST index supports bounding boxes, including split queries across the antimeridian; no PostGIS extension is required. The flight-tracking public interface exports the validated history contract; its PostgreSQL adapters remain private infrastructure used by composition. They are not connected to a live provider, API route, current-position selector, or public map. Real position retention still requires the ADR #0002 rights decision. Migration 007 is additive; rollback of application code leaves recorded rows and migration history intact. Schema changes after application require a new migration.

Node 24 type checking passed in the authoring checkout. Coordinator isolated CI subsequently passed at `e362998a8847e02137c7c03330283144ade07da4`; the confirmed-identity correction below requires a new exact-SHA run. No provider rights or deployment acceptance is implied by synthetic tests.

Authoring verification on 2026-11-20 used Node 24.22.3: offline `npm ci`, `npm run typecheck`, `npm run check:boundaries`, all 18 backend test files, `npm run test:messages`, and `git diff --check` passed. `npm run check` reached the existing private-preview test but failed because this shell cannot bind its synthetic loopback server. `npm run test:postgres:local` stopped before database startup because `initdb` refuses root; the coordinator's private unprivileged CI must run migration and PostgreSQL integration tests on the exact checkout. The migration's SQL behavior, query plan, concurrency and rollback assertions are written but are not yet claimed passing. No live source was fetched, retained, or published for #16.

### S4-03 PostgreSQL upgrade regression follow-up (2026-11-20)

Coordinator isolated CI for `40d3e5ed7689c4f617e81ce77097609feca1a24b` passed
`npm ci` and `npm run check` but failed 2 of 91 PostgreSQL integration tests.
Both failures were in predecessor upgrade tests whose exact migration lists still
ended at 006. Those tests now expect additive migration 007 during a full
upgrade, while retaining their checksum, record-preservation, and one-time
application checks. This is a test expectation update for the new migration;
the migration and runtime behavior are unchanged. The corrected checkout has
not yet passed PostgreSQL integration or coordinator exact-SHA CI. In the
authoring shell, Node 24 offline `npm ci`, type checking, architecture checks,
the focused position contract/history tests, and `git diff --check` passed.
`npm run check` stopped at the existing private-preview loopback test;
`npm run test:postgres:local` could not start because `initdb` refuses root.

### S4-03 source identity review follow-up (2026-11-20)

Merged predecessor #15 is present on main at `e1a5f33` (PR #57). Issue #16
remains in review, with no merge or issue closure claimed here. Coordinator
isolated CI passed the prior exact head, then requested a stronger source-fact
identity contract. The writer now requires a source-scoped key with an explicit
epoch and genuine measurement ID. The adsb.lol snapshot has no such provider ID;
its `preview:` key cannot be durably appended. Replays compare measurement
fields while allowing a later ingestion time or delivery reference, return the
first stored receipt and event ID, and leave row and outbox counts unchanged.
Synthetic PostgreSQL regressions cover this replay with a later fetch, reused
IDs across epochs, and independent facts with the same coordinates or time.
These changes do not establish real-source rights or actual provider identity
guarantees. Migration 007 remains additive and unchanged; there is no destructive
down migration. Local checks for this follow-up are recorded below.

In this authoring shell, Node 24.22.3 type checking, architecture boundaries,
the focused source/position suites, and `git diff --check` passed. `npm run check`
reached the existing private-preview loopback test and failed in this sandbox;
the focused tests passed. `npm run test:postgres:local` stopped before database
startup because `initdb` refuses root. The new PostgreSQL replay and identity
assertions were exercised by coordinator isolated CI at `e362998a8847e02137c7c03330283144ade07da4`. That passing result applies to the tested SHA, before the correction below.

### S4-03 confirmed-identity persistence correction (2026-11-20)

The write boundary now accepts the trusted upstream `PositionIdentityDecision` and validates it against the confirmed aircraft ID, source observation key, resolver evidence, and ICAO24 hint on first receipt. A missing or conflicting decision rejects the write. Retry and history reads validate facts loaded from the private immutable table through a separate stored-fact path; persisted identity evidence is retained as provenance and cannot authorize a fresh write. A synthetic PostgreSQL regression covers the rejected first receipts, confirmed insertion, restart retry with the original receipt and event ID, and history read. Migration 007 is unchanged and additive. It has no destructive down migration: reverting application code leaves the schema, migration ledger, and recorded rows in place; a schema correction requires a new migration. Real position retention remains gated by ADR #0002 and issue #46. The coordinator's passing isolated CI at `e362998a8847e02137c7c03330283144ade07da4` predates this correction, so the changed checkout requires a new exact-SHA run. In this authoring shell, Node 24.22.3 offline `npm ci`, type checking, architecture boundaries, all 18 backend test files, `npm run test:messages`, and `git diff --check` passed. `npm run check` stopped at the existing private-preview test in this shell; `npm run test:postgres:local` could not start because `initdb` requires an unprivileged user. The new PostgreSQL test has not yet run here. No live provider operation or deployment acceptance is claimed.

### S4-03 confirmed-identity replay review correction (2026-11-20)

The coordinator supplied a passing isolated CI result for exact SHA `4e69ecf`,
including 92 PostgreSQL integration tests. That result verifies migration 007,
restricted role and index checks, concurrent first writes, and outbox-failure
rollback at the tested head. Its confirmed-identity restart test supplied the
upstream decision again, so it did not cover a replay when that decision is
unavailable.

The writer now compares an existing stored fact before requiring an upstream
decision. A first receipt with confirmed identity still requires the matching
trusted decision; a matching replay returns the original receipt and event ID.
The PostgreSQL reader validates the 31-day window and 500-row limit at its own
entry point. A synthetic 20,000-row EXPLAIN regression checks spatial, ICAO24/time,
and time-key index selection without changing planner settings. These edits
follow `4e69ecf` and need a new unprivileged exact-SHA PostgreSQL run.

Node 24.22.3 offline `npm ci`, type checking, architecture boundaries, all 18
backend test files, focused position contract and query tests, and
`git diff --check` passed. `npm run check` stopped at the existing
private-preview loopback test. `npm run test:postgres:local` stopped before
startup because `initdb` cannot run as root; the new PostgreSQL regressions
are not claimed passing here. No SQL
changed in this correction. Migration 007 is additive, has no down migration,
and an applied schema correction requires a new migration. Reverting code
leaves its schema and rows. Real retention remains gated by ADR #0002 and
issue #46. Synthetic CI establishes no provider rights, live operation,
deployment, merge, or issue closure.
