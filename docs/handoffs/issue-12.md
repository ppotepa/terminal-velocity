# Issue #12 — bounded replay and source operations

Status: IN PROGRESS (local engineering record; coordinator owns GitHub status).
Owner: implementation agent for the Terminal Velocity coordinator.
Branch: `feature/epic4-issue-12`. Dependency: #11 engineering verified in PR #62; actual provider acceptance remains open;
local HEAD `752aa27` merges PR #62. Started November 19, 2026 UTC.

Plan: narrow replay ports and pure retry/range rules, durable scoped checkpoint
and health metadata, bounded replay orchestration, local redacted administrative
commands, synthetic failure/recovery regressions and operational documentation.
Expected paths: source-connectors application/domain/ports/PostgreSQL adapter,
migration 006, scripts/source, backend tests, SOURCE_OPERATIONS and status docs.
Constraints: repository edits only; no GitHub writes, commits, live capture,
retained real payloads, deployment, persistent services or subsequent issue work.
External acceptance remains BLOCKED pending provider collection/retention rights
and owner-approved private smoke; synthetic engineering proceeds independently.

Coordinator workspace correction: continue all authoring in `/root/work/git/terminal-velocity`. Partial issue #12 files were transferred with verified identical contents; the prior position branch and a relocation stash are preserved. GitHub list labels now reflect actual execution and external gates.

## Local implementation handoff — November 19, 2026, 21:14 UTC

Engineering remains IN PROGRESS pending coordinator verification/review. No
GitHub updates, branch changes, commits, pushes, merges, external messages or
real-provider acquisition were performed. Existing AGENTS.md changes were
preserved. All authoring remained in the canonical checkout on the supplied branch.
The supplied predecessor evidence (PR #62, HEAD `752aa27`) was confirmed locally;
no new remote verification is claimed.

Implemented:

- Bounded source/range/epoch/checkpoint contract, pure retry policy, durable
  reserved request budget/cooldown, per-source exclusion and resumable cursor.
- Retry-After uses the response receipt clock. The changing-clock regression
  starts at 10,000 ms, receives the 429 at 15,000 ms and verifies 19,000 ms for
  a 4,000 ms delay. Successful responses also preserve a receipt-based interval.
- Permanent/schema/rights failures enter durable redacted quarantine. Review
  requires an exact checkpoint and current permission; cursor expiry requires
  an explicit bounded restart. No automatic budget resets on process restart.
- Fetch, parse and receipt outcomes are independent. Sampled healthy empty pages
  do not advance provider timestamps. Inspection recomputes lag from observed
  time. New ranges preserve source health and cooldown. Late responses after
  timeout and rights revocation between receipts cannot continue acceptance.
- Local `source:replay` / `source:inspect` commands compose the explicit synthetic
  reader with the real metadata acceptance transaction. They reject remote or
  unscoped administrative inputs and return no payload, raw cursor or credentials.
- Migration 006, seven real PostgreSQL regression cases, eleven replay unit cases,
  operational runbook, migration notes and implementation status updates.

The original `npm run messages -- crawl ICAO24` implementation and existing
browser fixtures were not changed. It still selects the actual rendered reader;
the replay fixture is a separate opt-in command. The API strategy stays inactive.
No real content is retained or acquired by these changes.

## Commands and observed results

Node 24.22.3 was extracted from the already available local archive into ignored
`tmp/node24/package/bin/node` inside the repository, without installation outside
the checkout or a download. Commands below used
`PATH="$PWD/tmp/node24/package/bin:$PATH"`. npm is the installed npm executable.
Local diagnostic logs are in ignored `tmp/issue12-*.log`.

| Exact command | Result |
|---|---|
| `npm ci --offline --no-audit --no-fund` | PASS, 21 packages; sandbox emitted `fchown EINVAL` tar warnings |
| `npm run check` | FAIL overall: type checks and boundary check pass; architecture and 15 backend test files pass; API 2 files pass / 4 files fail in this sandbox |
| `npm run typecheck` | PASS, backend and API, rerun after implementation changes |
| `npm run check:boundaries` | PASS, 215 source files; final dependency count in local log |
| `node --test --test-isolation=none packages/backend/tests/*.test.mjs` | PASS, 139/139 tests, zero skipped, including 11 replay tests |
| `node packages/backend/tests/source-replay.test.mjs` | PASS, 11/11 replay cases |
| `node --test --test-isolation=none scripts/architecture/*.test.mjs scripts/messages/page-budget.test.mjs packages/backend/tests/airframes-transport.test.mjs packages/backend/tests/source-normalization.test.mjs apps/api/tests/config.test.mjs apps/api/tests/storage-config.test.mjs` | PASS, 73/73 (overlaps backend/message suites; do not add totals) |
| `npm run test:messages` | PASS, all 3 test files |
| `node --test --test-isolation=none scripts/messages/page-budget.test.mjs packages/backend/tests/airframes-transport.test.mjs packages/backend/tests/source-normalization.test.mjs` | PASS, 41/41 tests |
| `npm run demo` | PASS, correlation/outbox/freshness/correction demonstration |
| `npm run test:postgres:local` | BLOCKED before tests: `PostgreSQL initdb must run as an unprivileged user.` No integration test pass claimed |
| `npm run smoke` | FAIL: loopback `listen EPERM` |
| `npm run test:browser` | FAIL, both test files; direct diagnostic below |
| `node --test --test-isolation=none scripts/messages/airframes-live.test.mjs scripts/messages/on-demand.test.mjs` | 1 pass / 25 fail / 0 skipped; Chromium sandbox shutdown denied or loopback `listen EPERM` |
| `node --test --test-isolation=none apps/api/tests/*.test.mjs` | 4 pass / 26 fail / 0 skipped; loopback denied and child processes fail readiness |
| `node --check packages/backend/tests/integration/source-replay.test.mjs` | PASS (syntax only, not SQL execution) |
| `node --check scripts/source/replay.mjs` and `node --check scripts/source/inspect-quarantine.mjs` | PASS (syntax only) |
| `git diff --check` | PASS |

Default Node subprocess isolation reports file totals in this execution
environment. Direct/no-isolation runs above provide individual behavioral counts;
no root test scripts were changed to hide failures. Browser, API and PostgreSQL
results must be rerun in the coordinator's existing private unprivileged CI.

## Acceptance evidence and remaining gates

- [x] Pure retry, delayed response, bounded overlap, poison/review, expired cursor,
  partial outage/lost receipt ACK, quotas, bytes, record/request limits, clock
  skew, incomplete time, rights changes and redaction exercised locally.
- [x] Sampled healthy empty-page semantics and old observed time exercised locally.
- [x] Operational recovery and private #13 handoff documented in SOURCE_OPERATIONS.
- [ ] **Failures are visible and recoverable with bounded work:** unit behavior
  passes; durable and administrative SQL execution still needs coordinator CI.
- [ ] **Replay is idempotent and cannot produce fresh status from old observed
  time:** pure tests pass; real receipt/outbox restart, crash and overlap tests
  are written but not executed here.
- [x] **Health explicitly distinguishes sampled coverage from feed failure:**
  passing unit cases cover empty healthy samples, schema drift, source failure,
  timestamp preservation, lag and separate receipt failure.
- [ ] **Merged PR linked; passing checks, actual commands/results and limitations
  recorded:** local results recorded above; PR, exact-SHA CI and merge belong to
  the coordinator and remain pending.

Seven added PostgreSQL cases cover the normal synthetic composition, independent
pool restart, overlapping pages with one receipt/outbox event, crash after durable
receipt but before checkpoint, source lock contention/release, delayed retry and
quarantine review, atomic failed update/runtime grants, actual local CLI execution,
and poison correction. They are discovered automatically by `test:postgres:local`
and `test:integration`; unit tests run through `npm run check`. Existing browser
regressions remain exposed through root `test:browser`.

Migration 006 is additive and uses the existing source owner/runtime roles. Stop
replay invocations to roll application use back; preserve checkpoint and migration
history. The SQL tests must verify upgrade/checksum behavior and runtime grants in
the isolated runner before merge. No migration was applied to a persistent service.

Remaining external acceptance is BLOCKED on approved provider collection/retention
terms, an actual historical cursor contract and owner-approved private smoke in
#13. The generic reader port and explicit synthetic fixture are not evidence that
Airframes provides historical pagination. No completeness percentage, live feed,
public permission or deployment is claimed. Review retains only the current
checkpoint's redacted metadata, not an immutable quarantine archive or payloads.
The reader adapter must honor cancellation and enforce allocation bounds during
fetch; a stalled adapter that ignores AbortSignal cannot be made bounded by a
Promise race. Counts reflect saved acknowledgments rather than a global unique
message count, and partial retries can exhaust the bounded budget until reviewed.
