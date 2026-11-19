# Issue #11 local execution and handoff

Status: IN PROGRESS (local record; coordinator owns the GitHub issue).
Owner: implementation agent for the Terminal Velocity coordinator.
Started: 2026-11-19 19:51 UTC. Branch: `feature/epic4-issue-11`.
Dependency: #10 is merged in checkout HEAD `75c9536` (PR #61); DONE/verified supplied by coordinator.

Plan: bridge heterogeneous producer events without losing Stage2 deliveries; add a synthetic-only durable canonical input, immutable provider revisions and lineage; consume with an independent inbox and existing correlation use case; project private availability separately; test migration, replay, rollback, concurrency, and demo isolation.
Touched areas: migration 004, source-connectors application/ports/adapters/composition, event-delivery transaction adapter, integration tests and documentation.
Constraints: no GitHub writes, commits, branch changes, external messages, real content retention or deployment. Real provider acceptance is BLOCKED pending confirmed retention/use rights and an approved private ingestion policy. Engineering proceeds with explicitly synthetic data only. PR/merge/remote CI evidence belongs to coordinator.

## Final local handoff — 2026-11-19 20:25 UTC

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
