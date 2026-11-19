# Issue #11 local execution and handoff

Status: IN PROGRESS (local record; coordinator owns the GitHub issue).
Review P1 started: 2026-11-19 20:36 UTC. Owner: implementation agent; branch `feature/epic4-issue-11`; #10 DONE per coordinator and merged PR #61 in history. Plan: explicit rendered-delivery bridge in permitted composition, PostgreSQL success/rejection/replay coverage, pipeline documentation. No GitHub writes; external provider rights remain blocked pending owner approval.
Review revision started: 2026-11-19 20:27 UTC, same owner/branch and #10 prerequisite.
Plan: add explicit scoped retention permission and normal provider composition, migration 005 preserving existing lineage, provenance conflict and mixed fanout regressions. External rights remain blocked; no GitHub writes authorized.
Owner: implementation agent for the Terminal Velocity coordinator.
Started: 2026-11-19 19:51 UTC. Branch: `feature/epic4-issue-11`.
Dependency: #10 is merged in checkout HEAD `75c9536` (PR #61); DONE/verified supplied by coordinator.

Plan: bridge heterogeneous producer events without losing Stage2 deliveries; add a synthetic-only durable canonical input, immutable provider revisions and lineage; consume with an independent inbox and existing correlation use case; project private availability separately; test migration, replay, rollback, concurrency, and demo isolation.
Touched areas: migration 004, source-connectors application/ports/adapters/composition, event-delivery transaction adapter, integration tests and documentation.
Constraints: no GitHub writes, commits, branch changes, external messages, real content retention or deployment. Real provider acceptance is BLOCKED pending confirmed retention/use rights and an approved private ingestion policy. Engineering proceeds with explicitly synthetic data only. PR/merge/remote CI evidence belongs to coordinator.

## Historical initial local handoff — 2026-11-19 20:25 UTC

Engineering implementation is ready for coordinator review. Local acceptance is
BLOCKED on executable PostgreSQL verification and external provider rights; this
is not a GitHub status transition, a merged result or permission to advance #12.
No commits, pushes, GitHub writes, branch changes, real-source captures, hosted
services or deployment were performed. Initial checkout was clean; all changes
are scoped to #11. Coordinator retains branch/main integration and review.

### Delivered implementation

- Migration 004 backfills a registry of source/correlation producer identities and
  replaces the Stage2 correlation-only delivery FK without deleting deliveries.
  Both dispatchers register identities transactionally and reject provenance
  collisions. Producer-owned outboxes retain their existing event types.
- Explicit synthetic canonical snapshots preserve #10 normalized fields and page
  provenance. Ordinary/live acceptance remains metadata-only; no real-content
  persistence path was enabled. The on-demand rendered crawl and inactive API
  adapter are unchanged.
- Consumer-specific canonical inbox digests and stable transformation identity
  `provider-message/1`; namespaced provider message IDs, immutable revisions,
  multiple source delivery links and exact import decision revisions.
- Source inbox, message facts/links, existing public correlation use case,
  decision/outbox and delivery ACK share one SQL transaction. Retryable failures
  roll back all effects. Typed import outcomes preserve unresolved decisions;
  unsupported/missing evidence and identity conflicts quarantine without facts.
- Separate private availability consumer/table with atomic inbox/projection/ACK,
  observation-time freshness, correction tombstones and stale revision handling.
  Existing demo REST content, counts and status never read provider tables.
- A source replay receipt retains the original import decision even after later
  correlation corrections. [Pipeline documentation](../PROVIDER_PIPELINE.md)
  includes lineage SQL, migration/rollback limitations and the #12 replay boundary.

### Executable coverage added (SQL outcomes still unverified here)

`packages/backend/tests/integration/provider-message-pipeline.test.mjs` adds 15
PostgreSQL tests, including an injected rendered-page connector → normalization →
source acceptance → import → private availability flow. It covers concurrent
workers and distinct deliveries, lost COMMIT reply, SIGKILL before/after import,
rollback after effects, duplicate replay, identical text at distinct transmission
IDs/times, namespace epochs, UNMATCHED/AMBIGUOUS/CONFLICTED, invalid ICAO,
incomplete candidates, unsupported level, missing observation time, retention
quarantine, immutable grants, backfill, correction and stale-event handling.

The existing baseline migration test now also creates a queued correlation event
before migration and consumes it after the registry upgrade; the API integration
suite adds a real HTTP test proving provider records/status are absent from
unauthenticated demo reads while the existing synthetic POST remains usable.
The test runner already discovers these files under `test:postgres:local` and
`test:integration`; no CI-only manual test step is required. Root `check` discovers
the 12 new database-independent import tests. Root `test:browser` remains present
and still tests the actual lookup strategy with injected browser fixtures.

### Exact local verification

Commands used `PATH="$PWD/tmp/node24/bin:$PATH"`, Node **24.22.3**, npm **9.2.0**.
The Node binary came from the previous task's existing `/tmp/issue10-node24.tgz`
archive into ignored worktree `tmp/node24`; no download occurred. An initial
installation used the shell's Node 20 and was repeated under Node 24.

| Command | Actual result |
|---|---|
| `npm ci --offline --no-audit --no-fund` | PASS, 21 packages; sandbox fchown warnings |
| `npm run check` | FAIL in API suite: architecture 1/1 files and backend 12/12 files pass; API 2/6 files pass, 4 fail |
| `npm run typecheck` | PASS, both workspaces |
| `npm run check:boundaries` | PASS, 202 source files / 719 dependency edges |
| `node --test --test-isolation=none packages/backend/tests/*.test.mjs scripts/architecture/*.test.mjs scripts/messages/page-budget.test.mjs` | PASS, 162 tests, zero failures/skips |
| `node --test --test-isolation=none packages/backend/tests/provider-message-import.test.mjs` | PASS, 12 tests, zero failures/skips |
| `npm run test:postgres:local` | BLOCKED before any test: `PostgreSQL initdb must run as an unprivileged user` |
| `npm run test:messages` | PASS, 3/3 files |
| `npm run test:browser` | FAIL, 0/2 files pass |
| `node scripts/messages/airframes-live.test.mjs` | FAIL, 1/13 tests pass; Chromium reports `shutdown: Operation not permitted` |
| `node apps/api/tests/api.test.mjs` | FAIL, 0/22 tests pass; localhost `listen EPERM` |
| `npm run demo` | PASS; correlation/outbox/freshness/A→B correction output |
| `npm run smoke` | FAIL; localhost `listen EPERM` |
| `node --check packages/backend/tests/integration/provider-message-pipeline.test.mjs` | PASS syntax only, not a database execution |
| `node --check apps/api/tests/integration/postgres-runtime.test.mjs` | PASS syntax only |
| `git diff --check` | PASS |

The final full check log is `tmp/issue11-check-final.log`; other local logs are
`tmp/issue11-*.log` (ignored artifacts, not committed evidence). The additional
rendered-adapter SQL test was syntax-checked after that final run; SQL remains
unexecuted. No assertion or permission check was weakened to obtain a pass.

### Original acceptance and verification gates

- [ ] One approved provider payload flows through the durable backend end to end.
  External acceptance BLOCKED: owner must establish retention/use rights and an
  approved private ingestion policy before any actual payload may be persisted.
  Synthetic engineering coverage is not live provider evidence.
- [ ] Source lineage is inspectable for every message and status. Code and SQL
  query delivered; execute the PostgreSQL suite before accepting the claim.
- [ ] Synthetic demo endpoints remain backward compatible. Existing code contract
  retained, new HTTP isolation test delivered; executable API/database checks
  need the coordinator's environment.
- [ ] Merged PR linked, passing checks and actual results recorded. No PR/commit/
  remote CI/merge was created or verified by this agent.
- [ ] Real PostgreSQL fixture delivery → private correlation/status flow passes.
- [ ] Commit/reply loss, duplicate delivery, distinct transmissions, unknown
  aircraft, rollback, concurrent workers and process restart pass on PostgreSQL.

Coordinator unblock: run the exact-SHA install/check/PostgreSQL/demo/smoke/
messages/browser sequence under the authorized private systemd user with Node
24, PostgreSQL binaries and working local sockets/browser sandbox. Review and
resolve any failures before merging. Separately retain the live-provider rights
block until documented approval exists. Update the existing issue/EPIC records
only with actual evidence; do not mark DONE or advance #12 from this handoff.


## Review revision handoff — 2026-11-19

Status: IN PROGRESS locally; changes prepared for coordinator review. This section
supersedes the initial synthetic-only implementation description above. Coordinator
feedback supplies passing exact-SHA evidence for **be0f946**, not for these edits.
No GitHub issue/status writes, commits, merges, real captures or external operations
were performed. #10 prerequisite and PR #61 are confirmed in local ancestry;
closure/verification is supplied by the coordinator.

Implemented P1: the normal `createPermittedProviderPipeline` accepts normalized
provider records only with explicit operator retention/private-processing permission
matching source/provider/account/epoch and a recorded evidence reference. Migration
005 preserves snapshots and FKs while replacing synthetic identity restrictions
with required scoped evidence. Runtime cannot modify retained inputs/permission.
The synthetic helper delegates to that path. No actual Airframes permission is
configured; rendered on-demand preview remains transient and API adapter inactive.

Added regressions: non-synthetic provider namespace with synthetic content and test
permission reaches private availability after worker reconstruction; absent/false/
mismatched permission fails before writes; changed original source ID and original
registration spelling conflict under the same delivery identity; later-clock replay
preserves first canonical ingestion evidence and receipt origin; a provider backlog
larger than the demo fanout batch cannot starve or leak into demo deliveries.
Migration coverage verifies 004 snapshots survive 005 with FK targets and permission
checks intact. Existing Stage2 queue upgrade coverage includes migration 005.

Verification used Node 24.22.3 via `PATH="$PWD/tmp/node24/bin:$PATH"` and npm 9.2.0:

| Command | Actual result for review revision |
|---|---|
| `npm ci --offline --no-audit --no-fund` | PASS, 21 packages, sandbox fchown warnings |
| `npm run check` | Typecheck and boundaries PASS (204 files / 733 edges); architecture 1/1 files, backend 13/13 files PASS; API 2/6 files pass, 4 fail |
| `node --test --test-isolation=none packages/backend/tests/*.test.mjs scripts/architecture/*.test.mjs scripts/messages/page-budget.test.mjs` | PASS 165/165 tests, zero skipped |
| `npm run test:postgres:local` | BLOCKED before tests: initdb requires an unprivileged user |
| `npm run test:messages` | PASS 3/3 test files |
| `npm run test:browser` | FAIL 0/2 test files in this sandbox |
| `node scripts/messages/airframes-live.test.mjs` | FAIL 1/13 pass; Chromium shutdown operation not permitted |
| `node apps/api/tests/api.test.mjs` | FAIL 0/22 pass; loopback listen EPERM |
| `npm run typecheck` (final) | PASS, both workspaces |
| `node --check` on both edited integration test files | PASS syntax checks only |
| `git diff --check` | PASS |
| `npm run demo` | PASS, exit 0 |
| `npm run smoke` | FAIL, loopback listen EPERM |

Logs: ignored `tmp/issue11-revision-*.log`. SQL migration and new PostgreSQL tests
remain unexecuted here. Coordinator must run the full exact-SHA private CI sequence
before accepting these changes; earlier 69/69 PostgreSQL evidence does not cover
migration 005 or new tests. Migration/rollback and lineage query are documented in
[PROVIDER_PIPELINE.md](../PROVIDER_PIPELINE.md).

External acceptance remains unchecked: owner must establish retention/use rights
and supply approved private payload/permission evidence before live verification.
Merged PR/checks remain coordinator-owned and unchecked. No later issue started.

## P1 rendered-delivery bridge revision — 2026-11-19 20:40 UTC

Local status: implementation ready for coordinator review; fresh PostgreSQL and
full CI verification remain pending. No GitHub status/merge/closure is claimed.

- Added `createPermittedProviderPipeline(...).acceptRendered(delivery, context,
  scope)`. It invokes the existing rendered normalizer and shares the extracted
  record path's permission check and acceptance transaction. It derives digest,
  page URL, extractor version and retrieval/ingestion provenance internally.
- Replaced the integration test's manual normalizer/SQL assembly with the actual
  permitted entry point from an injected synthetic connector callback. Assertions
  cover private MATCHED correlation/status, immutable message/status lineage,
  worker reconstruction, later-clock acceptance replay, single effects and empty
  demo tables. Added PostgreSQL rejection coverage for page/identifier/time,
  verified scope and retention permission with no retained effects.
- Added three database-independent regressions for the bridge: valid normalization
  reaching unavailable storage without false ACK; permission/scope rejection
  before SQL; invalid rendered evidence rejection. Root `check` discovers them.
  The integration runner discovers the updated suite (18 tests in that file).
- No migrations, CLI changes, API activation, real content capture or new rights
  grants. Existing migration 004/005 upgrade and rollback limitations still apply.

### Fresh local verification of this revision

All commands used `PATH="$PWD/tmp/node24/bin:$PATH"` (existing Node 24.22.3,
npm 9.2.0). Logs are in ignored `tmp/issue11-p1-*.log` in this worktree.

| Command | Actual result |
|---|---|
| `npm ci --offline --no-audit --no-fund` | PASS, 21 packages; sandbox fchown warnings |
| `npm run check` | FAIL overall: typechecks PASS; boundaries PASS (204 files / 736 edges); architecture 1/1 test files PASS; backend 14/14 files PASS; API 2/6 files PASS, 4 FAIL |
| `node --test --test-isolation=none packages/backend/tests/*.test.mjs scripts/architecture/*.test.mjs` | PASS, 156 tests, 0 failures, including all 3 new bridge tests |
| `npm run test:messages` | PASS, 3/3 files |
| `node --test --test-isolation=none scripts/messages/page-budget.test.mjs packages/backend/tests/airframes-transport.test.mjs packages/backend/tests/source-normalization.test.mjs` | PASS, 41 tests |
| `npm run test:postgres:local` | FAIL at setup: initdb requires an unprivileged user; 0 database tests executed |
| `npm run test:browser` | FAIL, 0/2 files pass |
| `node --test --test-isolation=none scripts/messages/airframes-live.test.mjs scripts/messages/on-demand.test.mjs` | FAIL, 1/26 tests pass, 25 fail; Chromium sandbox operation not permitted and fixture listener restrictions |
| `node --test --test-isolation=none apps/api/tests/*.test.mjs` | FAIL, 4/30 tests pass, 26 fail; loopback listen EPERM / children exit before readiness |
| `npm run demo` | PASS, synthetic demonstration completed |
| `npm run smoke` | FAIL, loopback listen EPERM |
| `git diff --check` | PASS |

The initial typecheck found a raw number where branded `EpochMillis` was required;
the bridge now uses the normalizer's validated retrieval timestamp. Initial unit
fixtures omitted required timestamp uncertainty; corrected the synthetic evidence,
without weakening assertions, before the passing run above.

The coordinator's supplied earlier exact-SHA CI result is historical evidence for
`cb327dd`, not verification of this revision. Required next verification is the
coordinator's isolated unprivileged CI on the revised SHA, especially real
PostgreSQL rendered acceptance/replay. No host changes or privilege workarounds
were attempted. Actual provider retention/use rights and approved-payload
acceptance remain BLOCKED externally until the owner supplies confirmed rights
and an approved private payload. Synthetic fixtures do not satisfy that gate.
