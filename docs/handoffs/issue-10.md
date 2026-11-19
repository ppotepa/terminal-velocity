# Issue #10 — normalization handoff

### Latest review correction — duplicate field order (2026-11-19)

Baseline: `793f897`. Duplicate rendered records now compare facts independently
of property order, both within a DOM sample and across the observation window.
Reordering Registration and Callsign labels no longer creates `PARTIAL_LAYOUT`;
changed values still do. Four synthetic browser regressions cover both outcomes
in both locations, assert that multiple samples were actually read, and verify
that the normalization window accepts identical duplicates and rejects conflicts.
They run through the existing root `test:browser` entry point.

Local verification with `PATH="$PWD/tmp/node24/bin:$PATH"` (Node 24.22.3):

| Command | Actual result |
|---|---|
| `npm ci --offline --no-audit --no-fund` | PASS, 21 packages; sandbox fchown warnings |
| `npm run check` | FAIL: typecheck, boundaries, architecture file and 11 backend files pass; API files: 2 pass, 4 fail |
| `npm run test:messages` | PASS, 3 files, zero failures/skips |
| `node --test --test-isolation=none scripts/messages/page-budget.test.mjs packages/backend/tests/airframes-transport.test.mjs packages/backend/tests/source-normalization.test.mjs` | PASS, 39 tests, zero failures/skips |
| `npm run test:browser` | FAIL, 0/2 files pass |
| `node scripts/messages/airframes-live.test.mjs` | 1 test passes, 8 fail at Chromium startup (`shutdown: Operation not permitted`), zero skipped; browser regressions remain unverified locally |
| `git diff --check` | PASS |

Coordinator-supplied CI evidence for the prior head is not verification of this
correction. Run exact-SHA CI, particularly the four added browser cases, before
acceptance. No SQL or startup wiring changed; PostgreSQL was not rerun for this
correction. The actual rendered `crawl ICAO24` path and transient-only retention
remain unchanged. No live acquisition or GitHub writes were performed.

External acceptance remains **BLOCKED**: the owner must supply permission evidence
and an authorized, versioned source sample, then validate the fabricated optional
selectors and timestamp assumptions against it. Synthetic tests do not establish
real-provider compatibility. PR, merge and final acceptance remain coordinator-owned.

## Status / execution log
- 2026-11-19 19:35 UTC — IN PROGRESS for duplicate-field-order review correction;
  owner implementation agent, branch feature/epic4-issue-10, baseline 793f897.
  Dependency #9 remains merged per coordinator and local history. Scope: rendered
  reader comparisons and browser regressions within/across samples; external
  permission and versioned-sample acceptance remains BLOCKED. GitHub updates and
  exact-SHA CI remain coordinator-owned.
- 2026-11-19 19:24 UTC — IN PROGRESS for coordinator CI feedback on 9668ba1;
  owner implementation agent, branch feature/epic4-issue-10, prerequisite #9
  unchanged. Scope: baseline migration test teardown, deterministic lifecycle
  regressions and verification evidence. External acceptance remains blocked.
- Status: BLOCKED for external acceptance and coordinator verification; local engineering prepared.
- Owner: implementation agent assigned by coordinator.
- Branch: feature/epic4-issue-10; baseline 4761d31 (merge PR #60 for #9).
- Dependency: #9 engineering merged and verified at 4761d31; external source acceptance remains open.
- Last update: 2026-11-19 19:14 UTC.
- Review fixes: implementation prepared locally; owner implementation agent, same branch,
  dependency #9 unchanged. Validate the complete rendered scroller layout and
  fractional timestamp precision; add browser and normalization regressions,
  rerun local checks and hand exact-SHA CI back to the coordinator. External
  acceptance remains BLOCKED pending permitted versioned samples and verification
  of the fabricated optional selectors.
- History: 18:57 UTC — local IN PROGRESS recorded before implementation;
  19:09 UTC — engineering handoff, external acceptance remains BLOCKED.
- Planned paths: source-connectors normalization contracts/adapters, rendered-page reader,
  synthetic fixtures, backend/browser tests, source documentation.
- Constraints: repository-only edits; no GitHub writes, commits, network acquisition,
  credentials, deployment or persistent services. Existing demo API stays unchanged.
- External acceptance blocker: ADR 0001 has no permitted real sample. Owner must
  provide rights evidence and a permitted versioned sample before live validation.
- PR/merge/remote checks: coordinator-owned; not performed by this agent.

The coordinator records GitHub progress and authorizes sequential engineering while
external acceptance remains open. This handoff records the local implementation evidence.

## Engineering handoff

- Local implementation is prepared. Final issue acceptance remains **BLOCKED** on
  the external sample/rights gate and coordinator verification below; no DONE or
  merged-PR claim is made.
- Implemented strict versioned decoding, distinct time evidence and uncertainty,
  independent protocol/bearer classification, normalized aircraft hints and roles,
  immutable source provenance, explicit message/reception/frame validation, and
  a transient rendered-card adapter. Invalid records return safe typed failures.
- The browser reader preserves optional displayed evidence, distinguishes empty
  results from incompatible layouts, and rejects ambiguous/conflicting records.
- Added synthetic golden JSON fixtures, 13 normalization regressions and an
  offline browser-to-normalizer scenario. `test:messages` now includes normalization;
  `check` and `test:browser` also exercise the new tests through existing entry points.
- Documented the full revision/provenance handoff for #11 in `docs/SOURCES.md`.
  No #11 persistence implementation was started.

### Acceptance review

- [x] Canonical result includes correct provenance and declared data level —
  verified with synthetic message, reception and frame inputs.
- [ ] Unknown/invalid provider variants fail explicitly without dropped silent
  records — strict synthetic versioned schema and negative regressions. Browser
  layout behavior has expanded executable regressions awaiting sandbox-capable CI.
- [x] All fixtures are anonymized and permitted for repository use — all are
  repository-authored synthetic data with no real-source material; fixture README
  explicitly records this distinction. No real-source permission is asserted.
- [ ] Merged PR linked; passing checks, actual commands/results and limitations
  recorded — local evidence below; PR, merge and CI remain coordinator-owned.
- [ ] Permitted real-shape golden sample and live provider verification — owner
  must supply ADR 0001 rights evidence and an authorized sample. The optional
  semantic markup is fabricated and must be checked against that sample.

### Local commands and results

Node **24.22.3** was extracted from the already cached npm binary tarball into the
ignored worktree `tmp/node24` directory. No network fetch occurred. Commands used
`PATH="$PWD/tmp/node24/bin:$PATH"`; no runtime or toolchain files are part of the patch.
The shell's original default Node was 20.19.2, which cannot execute these TS tests;
that initial test attempt was replaced by the Node 24 runs below.

| Command | Actual result |
|---|---|
| `npm ci --offline --ignore-scripts --no-audit --no-fund` | PASS, 21 locked packages installed under Node 24; npm emitted sandbox `fchown` warnings, exit 0 |
| `npm run typecheck` | PASS, both workspaces |
| `npm run check:boundaries` | PASS, 193 source files / 663 AST dependencies |
| `node packages/backend/tests/source-normalization.test.mjs` | PASS, 13/13 tests, zero skipped |
| `node --test --test-isolation=none packages/backend/tests/*.test.mjs scripts/architecture/*.test.mjs scripts/messages/page-budget.test.mjs` | PASS, 145/145 tests, zero skipped |
| `npm run test:messages` | PASS, all 3 test files (transport, budget, normalization); this environment's isolated runner reports file totals |
| `npm run check` | NOT GREEN: typecheck, boundaries, architecture and all 10 backend test files pass; API suite has listener-dependent failures. Both full runs: 2/6 API files pass, 4 fail. Direct health diagnostic confirms `listen EPERM 127.0.0.1` |
| `npm run demo` | PASS, synthetic correlation/outbox/freshness/correction example |
| `npm run smoke` | FAIL before API listening: `listen EPERM 127.0.0.1` |
| `npm run test:postgres:local` | BLOCKED before tests: launcher requires an unprivileged user; current sandbox runs as root |
| `npm run test:browser` | FAIL, 0/2 browser test files. Direct rendered-page file: 1/5 tests passes (API unavailable), 4 cannot launch Chromium; sandbox startup reports `shutdown: Operation not permitted`. No browser E2E pass is claimed |
| `git diff --check` | PASS |

The unisolated command above provides individual test counts that the default
isolated runner does not expose here; it does not substitute for failed API,
browser or PostgreSQL checks. No assertions or sandbox protections were weakened.
These are local results, not coordinator CI or hosted CI evidence.

### Review corrections — 2026-11-19

Review baseline: `7eb83cd9673884453237726117d00fed806f7b6f`. These fixes are
uncommitted worktree changes; exact-SHA CI must run after the coordinator commits
them. The earlier coordinator-supplied CI results concern the baseline and do not
verify this patch.

- The reader now accounts for all scroller nodes outside recognized cards. Unknown
  text or elements produce `PARTIAL_LAYOUT`, including alongside valid cards or an
  empty-state label. Valid records remain available in the transient preview, but
  the normalization window validator rejects the partial window. Browser fixtures
  cover text-only drift, mixed records, changed item layouts, empty status and
  empty wrapper success, and a valid card inside the supported wrapper.
- One-, two- and three-digit fractional UTC timestamps map to the contract's
  `MILLISECOND` category, with ISO padding and declared uncertainty preserved.
  Tests exercise all three source clocks, canonical observation time, serialization
  and rejection of unsupported four-digit fractions. Whole seconds remain `SECOND`.
- The real `crawl ICAO24` browser acquisition path remains in place. No live
  acquisition was performed; no real content was retained. No SQL, migration or
  startup changes are included in this correction.

All commands below used the existing Node 24.22.3 binary via
`PATH="$PWD/tmp/node24/bin:$PATH"`. This patch's local results supersede the older
table for review verification:

| Command | Actual result |
|---|---|
| `npm ci --offline --ignore-scripts --no-audit --no-fund` | PASS, 21 packages, exit 0; sandbox `fchown` warnings |
| `node packages/backend/tests/source-normalization.test.mjs` | PASS, 14 tests, 0 failed/skipped |
| `npm run check` | FAIL at API tests: 2/6 API files pass, 4 fail; typecheck, boundary check, architecture file and all 10 backend files pass |
| `node --test --test-isolation=none packages/backend/tests/*.test.mjs scripts/architecture/*.test.mjs scripts/messages/page-budget.test.mjs` | PASS, 146 tests, 0 failed/skipped |
| `npm run test:messages` | PASS, 3/3 test files |
| `node --test --test-isolation=none scripts/messages/page-budget.test.mjs packages/backend/tests/airframes-transport.test.mjs packages/backend/tests/source-normalization.test.mjs` | PASS, 39 tests, 0 failed/skipped |
| `npm run test:browser` | FAIL, 0/2 files pass; browser launch unavailable |
| `node scripts/messages/airframes-live.test.mjs` | 1/5 tests passes; 4 fail during Chromium startup with `shutdown: Operation not permitted`; new rendered regressions could not execute |
| `npm run demo` | PASS, exit 0 |
| `npm run smoke` | FAIL, `listen EPERM 127.0.0.1` |
| `npm run test:postgres:local` | BLOCKED before tests: `initdb must run as an unprivileged user` |
| `git diff --check` | PASS |

The coordinator must rerun exact-SHA checks, including browser E2E, under the
trusted unprivileged CI worker. No passing browser or exact-SHA CI result for this
patch is claimed. Real-provider acceptance remains **BLOCKED** until the owner
supplies permitted, versioned source samples and verifies the fabricated optional
selectors against them. Merge and final issue acceptance remain coordinator-owned.

### Coordinator actions and remaining uncertainty

Run the normal exact-SHA CI sequence under the configured unprivileged worker,
including browser E2E, smoke and PostgreSQL tests. Inspect and resolve any actual
failures before review/merge; the restricted agent environment cannot establish
those results. The patch changes no SQL, transactions, migrations, grants or
startup wiring. No migration is required; rollback removes these normalization
modules and page-reader additions. The existing metadata store intentionally does
not persist the complete normalized revision wrapper.

For review, use a focused PR referencing #10 and explaining the synthetic scope,
explicit decoder failures and blocked real sample. The coordinator owns all
GitHub status transitions, branch integration, CI evidence, PR/merge links and
EPIC updates. This agent made no GitHub writes, commits, pushes or external
messages and did not advance the queue.

### PostgreSQL CI feedback correction — 2026-11-19 19:24 UTC

Coordinator evidence for **9668ba172bdf497d41e261ba0f18d91a0e350c4f**:
`npm run check` passed 28 architecture, 106 backend and 30 API tests.
PostgreSQL passed 52/53 tests, with the baseline upgrade test reporting
`terminating connection due to administrator command`. That run stopped before
browser verification; it does not establish a complete CI pass.

Inspection of the installed `pg-pool` implementation identifies a teardown race:
`pool.end()` can resolve after removing clients from its list but before their
`end` events. The baseline test then calls its disposable database's forced drop,
which can terminate a still-closing client. The test now registers disconnect
promises before its first connection and awaits all of them before database
cleanup. It keeps the migration, checksum and preserved-record assertions intact.
Unexpected pool errors are not suppressed. Two deterministic tests cover delayed
and already-ended clients, an unused pool, and propagation of shutdown errors;
they run through the existing root `check` command. This removes the identified
race; confirmation that it resolves the reported PostgreSQL failure still needs
the coordinator's unprivileged integration run.

Local verification used Node 24.22.3 via `PATH="$PWD/tmp/node24/bin:$PATH"`:

| Command | Actual result |
|---|---|
| `npm ci --offline --no-audit --no-fund` | PASS, 21 packages; sandbox fchown warnings |
| `npm run check` | FAIL at API suite: 2/6 files pass, 4 fail. Typecheck, boundaries (193 files/663 dependencies), architecture file and all 11 backend test files pass |
| `node --test --test-isolation=none packages/backend/tests/*.test.mjs scripts/architecture/*.test.mjs scripts/messages/page-budget.test.mjs` | PASS, 148 tests, zero failures/skips |
| `node packages/backend/tests/postgres-pool-lifecycle.test.mjs` | PASS, 2 tests, zero failures/skips |
| `npm run test:messages` | PASS, 3/3 files |
| `npm run test:postgres:local` | BLOCKED before tests: initdb requires an unprivileged user |
| `npm run test:browser` | FAIL, 0/2 files pass |
| `node scripts/messages/airframes-live.test.mjs` | FAIL; Chromium startup reports `shutdown: Operation not permitted` |
| `npm run demo` | PASS |
| `npm run smoke` | FAIL: listen EPERM on 127.0.0.1 |
| `git diff --check` | PASS |

No production code, SQL, migrations, rights checks, real crawl path or retention
behavior changed in this correction. No assertions were weakened. All earlier
external sample/rights and merge gates remain open. Coordinator: commit this
patch and rerun the full exact-SHA sequence, including PostgreSQL and browser
E2E; record actual results before review/merge. No GitHub writes or branch
integration were performed by this agent.
