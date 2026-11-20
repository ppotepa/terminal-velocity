# Terminal Velocity — Master Code Implementation Plan

> **Code-first LLM agent execution workbook · English-only project content**
>
> **Snapshot:** 2026-11-20 · `ppotepa/terminal-velocity` · baseline `main@ca44a02aefba64bac3a2bc23f6f1cf875e4f0e9c`.
> **Backlog:** [EPIC #4](https://github.com/ppotepa/terminal-velocity/issues/4), exactly 48 implementation issues [#5–#52](https://github.com/ppotepa/terminal-velocity/issues).
> **Immediate active work:** [issue #17](https://github.com/ppotepa/terminal-velocity/issues/17), [draft PR #66](https://github.com/ppotepa/terminal-velocity/pull/66), reviewed feature head `01fd8ba818c819a65ec201c80d98d31cb69c37c8`, NOT yet merged.
> **Main purpose:** obtain a convincing, running, locally tested aviation tracker prototype before investing in hosted CI/CD, production infrastructure, or public deployment.
>
> **This document is a snapshot of execution instructions, not a claim that every named file already exists.** Before each issue, reread current main, its issue, its predecessor and the current PR. Status and permissions are controlled by the live issues; this master contains the implementation method and a complete copy of their technical requirements **without their volatile status logs**.

---

## A. Non-negotiable project directive: IMPLEMENT CODE FIRST

The owner has changed priority from hosted release automation to **working product engineering**. The codebase must be demonstrably useful in a private local environment. Do **not** spend the near-term milestone on CI/CD configuration, GitHub Actions billing, hosted runners, branch protection, container registries, production clusters, cloud deployment, public DNS, release ceremonies, or routine workflow retries. This is NOT a waiver of local verification or security correctness.

**Still required during implementation:**

1. Node.js 24, strict TypeScript, architecture-boundary check, small unit tests for changed rules, and scenario-level tests for the behavior added in that issue.
2. Real disposable PostgreSQL integration tests **when** a task alters migrations, transaction boundaries, outbox/inbox, concurrent writes, leases, projections, or durable replay. A DB test may be run locally with Compose/binaries; it is not hosted CI.
3. Private HTTP/browser smoke tests for API/map/UI; verify user-visible behavior and error/empty/reconnect states. A failing local test is a reason to fix code; lack of GitHub Actions capacity is not.
4. A code review (at least a structured file-by-file self-review, preferably independent), a focused PR, merged SHA, written local evidence, and GitHub issue/EPIC status updates before marking DONE.
5. Data access, retention, licenses, privacy, and authentication: do not transform synthetic successes into claims of a licensed live feed. Do not publicly expose real provider content without explicit permission.

**Defer until the FINAL release wave:** issue #49 (GitHub Actions/CI merge gates), #50 (staging deployment), #51 (formal load/soak qualification) and #52 (production go/no-go). The rest of the code backlog can be designed, implemented, tested locally and merged without spending effort on hosted CI. The local test runner is an engineering tool, not CI/CD infrastructure.

## B. Current facts, existing code and real constraints

### B1. Repository and runtime

- Node.js `>=24 <25`, TypeScript strict `5.8.3`, npm workspaces; current packages are `packages/backend` and `apps/api`.
- Root scripts from current `package.json`: `npm run typecheck`, `npm run check:boundaries`, `npm test`, `npm run check`, `npm run test:postgres:local`, `npm run demo`, `npm run smoke`, `npm run test:messages`, `npm run test:browser`, `npm start`, `npm run example`.
- SQL uses package `pg`, with `db/migrations/001_*.sql` through `007_tracking_position_history.sql` on main. The active #17 branch adds fleet-identity migrations `008–015`. **Never claim these are on main until PR #66 merges.**
- The HTTP server lives in `apps/api/src/routing`, `apps/api/src/runtime` and `apps/api/src/http`. Current six routes are the synthetic `/healthz`, aircraft and message endpoints, and `POST /api/v1/demo/messages`; see `docs/API.md`.
- The domain/kernel primitives live in `packages/backend/src/kernel`; shared ID and SQL contracts in `packages/backend/src/contracts`. Reuse `Result<T,E>`, validated IDs and existing transaction helpers when appropriate.
- Implemented bounded contexts include `aircraft-correlation`, `message-availability`, `database-transactions`, `event-delivery`, `source-connectors`, and early `flight-tracking`.
- Current position adapter is a **private, opt-in adsb.lol preview**. No accepted real-source position history or stable observation ID is established. The message source work uses an **on-demand Airframes rendered-page lookup** and synthetic durable path; private retention/public distribution approval is not established.
- No `apps/web` workspace, public authenticated map, realtime WebSocket gateway, FlightSession correlation, general RF demodulation, or production deployment exists on main.

### B2. Source rights gates (do not cheat)

- [#6](https://github.com/ppotepa/terminal-velocity/issues/6) source selection/rights: BLOCKED for approved real message retention and a permitted sample.
- [#9](https://github.com/ppotepa/terminal-velocity/issues/9), [#10](https://github.com/ppotepa/terminal-velocity/issues/10), [#11](https://github.com/ppotepa/terminal-velocity/issues/11) and [#13](https://github.com/ppotepa/terminal-velocity/issues/13): engineering work exists, but actual provider acceptance is not complete.
- [#15](https://github.com/ppotepa/terminal-velocity/issues/15): private position transport/parser engineering exists, but real usage/retention evidence remains a separate gate.
- **Keep the issues open as external-gated** until their original acceptance criteria are genuinely satisfied; code-only status should be logged as `implementation:verified` rather than misleadingly labeled DONE.
- For a local prototype, use **synthetic fixtures or explicitly authorized local feeder data**. Build the rest of the application against the same strict input ports, and smoke-check a private end-to-end pipeline. Never fabricate RF frames, receivers, measured positions, grants or successful live E2E evidence.

### B3. Mandatory technical invariants

1. `observedAt`, `receivedAt`, provider timestamp precision/uncertainty, and `ingestedAt` are distinct. Freshness uses the observation time, never backfill arrival time.
2. Aircraft identity is temporal: ICAO24/registration are asserted over a validity interval; callsign alone is insufficient for confirmed identity. Missing/partial candidate coverage or conflicting strong identifiers must not produce a false MATCHED decision.
3. Actual data levels differ: `PROVIDER_MESSAGE` is not `FRAME`; a receiver `RECEPTION` needs genuine receiver evidence. Bearer VDL2 does not automatically prove application-level ACARS.
4. Message acceptance/decision/outbox writes belong to one database transaction. Per-consumer inbox, projection effect and ACK belong to another atomic transaction. Every SQL transaction uses **the same checked-out connection**.
5. Retries and replays must be idempotent; conflicting reuse of a stable source key is an explicit conflict. Old revisions cannot supersede newer authoritative versions. Keep immutable facts and decision/retraction history.
6. Position freshness, message freshness, source feed health and receiver coverage are separate concepts, separately displayed. An old position must not become recent because a message arrived; a healthy receiver with no RF output does not imply the aircraft did not transmit.
7. Publication permission must protect payloads **and derived fields**: last message time, counts, marker colors, station identity, changes, cursors, subscriptions, and denial/error responses. A browser must not choose its own visibility scope.
8. A snapshot checkpoint and its subsequent change log must have a reliable common commit order. Use a transactionally serialized stream head, not a bare sequence number that can commit out of order. Replay cursors are scope/filter/generation bound.
9. Bounded work everywhere: provider requests, parsing, HTTP bodies, SQL queries, paging, lease retries, worker turns, map bboxes, track vertices, WebSocket buffers, browser filters. Failing closed is preferable to a false “complete”.
10. Security and privacy for local prototypes: bind internal-only services to loopback, synthetic data is the default, never commit secrets, real provider messages, privileged connection strings, confidential station coordinates or unapproved sample payloads.

## C. Exact agent execution protocol (one issue at a time)

**At the beginning of EVERY issue:**

1. Read `AGENTS.md`, `docs/ISSUE_WORKFLOW.md`, this master plan, the live EPIC and the target GitHub issue. Fetch current GitHub `main` and open PRs. Inspect the predecessor's merged commit and affected files.
2. Determine if the issue is already closed, has verified code pending external approval, has an open PR, or has a pending branch. **Do not duplicate code.** Do not overwrite in-progress work from another checkout.
3. Pick the next code-eligible issue from Section D. Only one implementation issue can be `IN PROGRESS` or `IN REVIEW` at once. External rights gates may remain BLOCKED while independent local-code tasks proceed **only under the explicitly recorded EPIC code-first exception**.
4. Check the planned target file paths against the actual repository tree. Mark each as existing, to modify, or to create. The dated issue blueprints may suggest paths which have changed; preserve semantics, not obsolete filenames.
5. Edit the chosen issue body, retaining requirements/checklists, and add a dated plan with owner, branch, intended changed paths, API/schema choices, tests and explicit blockers. Use one focused feature branch named `feature/epic4-issue-N` or comparable.
6. **Implement the narrowest vertical result:** validated types and domain rules first; public port; use case; SQL/provider/API/UI adapter; composition; regression tests; docs. Never start a large generic framework or speculative microservices. One issue = one independently demonstrable behavior.

**Before opening review:**

7. Run the local commands relevant to what changed. Record the exact Node/PG versions and `pass/fail/skipped` counts. If a mandatory database/browser test could not run, say so and keep the issue IN REVIEW or BLOCKED — do not convert the absence of evidence to a pass.
8. Review all changed files against the issue's invariants: unsafe casts, cross-domain private imports, timestamp units, integer overflow, duplicate/race conditions, transaction connection ownership, resource bounds, source rights and public-data leakage. Add specific regression tests for discovered problems.
9. Open one PR referencing (not prematurely closing) the issue; include scope, exact API/schema, tested commands/results, limitations, migrations, and rollback/forward-only compatibility. Do not add CI/CD changes merely to make the PR appear green.

**After code review and local evidence:**

10. Merge the accepted PR to `main`. Confirm the merge SHA and, for material changes, rerun the affected local checks against the merged revision when an appropriate environment is available.
11. In the same session update the GitHub issue's body to `DONE`, check verified acceptance criteria, link the merged PR/SHA/local evidence, and close as `completed` **only if all original non-external criteria are met**. If live/provider acceptance remains outstanding, keep `status:blocked` + `implementation:verified` + `gate:external` as appropriate.
12. Update EPIC #4: check that issue, increment the correct stage/total DONE count, record a dated progress note, then set the next *eligible* code issue READY. An external gate must not be disguised as DONE by changing the wording after the fact.
13. A documented incomplete issue remains open. The next local-only engineering issue can proceed solely under the EPIC's explicit exception; never skip a direct technical dependency silently.

**Expected PR report format:**

`Issue #N · branch · base/main SHA · head SHA · changed paths · expected behavior · errors and bounds · local tests actually executed (versions and counts) · review findings fixed · migration/rollback impact · external blockers · merged SHA / not merged · next issue.`

## D. Sequencing and closure policy (this is the agreed CODE-FIRST order)

### D1. Completed reference tasks (DO NOT reimplement)

These are already closed on GitHub, subject to reconfirming status at execution time: **#5, #7, #8, #12, #14, #16**. Their detailed work packages below are a reference when reusing contracts and testing regressions.

### D2. Existing engineering but gated real-world acceptance (KEEP OPEN)

**#6, #9, #10, #11, #13, #15** have source-dependent acceptance that is still open. Keep the tested synthetic/software portions; do not recode them just to change a checklist. Revisit each only when the owner provides the actual access/license/sample evidence required in that issue. Any source-specific live smoke must be permitted, private, provenance-preserving and redacted in evidence.

### D3. Build the private executable product, in this sequence

**#17 → #18 → #19 → #20 → #21 → #22 → #23 → #24.**

- #17: finish PR #66. Verify latest head (now `01fd8ba`) with Node 24 and real local PostgreSQL. It adds migrations `008–015`, immutable fleet identity, temporal alias correction, durable replay and the three-class fair scheduler. Its three pure scheduler tests passed; do not assert full-suite verification for this head until actually executed. On passing code review/tests, merge, record SHA, close #17.
- #18: compute the deterministic, idempotent current-position projection independently from message availability. Preserve source quality/observed time; test out-of-order arrivals and rebuild.
- #19: produce actual observed-track segments and deterministic simplification with gaps and antimeridian handling, bound history pages.
- #20: internal HTTP bbox map snapshot from a coherent spatial read model; position/message status metadata are distinct, input and response sizes bounded, no unauthorized real payloads.
- #21: create `apps/web` with React/Vite/strict TS, design tokens, accessible primitives, API adapters, browser test tooling, mobile layout.
- #22: MapLibre markers, viewport loading/cancelation, observed track lines, URL state and tile failure fallback.
- #23: selected-aircraft details, message timeline, list, filters, explicit unknowns and data-level labels.
- #24: integrated **private synthetic MVP acceptance**: start PG, API, worker and browser; select one aircraft, see its position and messages; verify stale/unknown/unmatched/disconnected states. If actual source rights are absent, document that the code-only MVP is validated, but **do not close #24 as a live-source verification**.

**MVP feasibility gate:** after #23 / #24 software scenario, the answer to “does this architecture work?” should be observable from a browser: bounded viewport → selected aircraft → last observed position/track → independent message freshness and authorized decoded messages → durable restart/replay. If that fails, fix the current issue before adding other domains.

### D4. Implement rights-aware and incremental architecture locally

**#25 → #26 → #27 → #28 → #29 → #30 → #31 → #32 → #33.**

Implement and test all with synthetic multiple principals and visibility scopes. Do not expose provider data publicly until real rights are granted. Critical acceptance: a hidden message must not affect marker color, lastMessageAt, count, cursor, HTTP response size or WebSocket notifications. A grant revocation must invalidate both current reads and old subscription/replay data.

**Realtime feasibility gate:** WebSocket snapshot+replay after checkpoint, reconnect after a dropped connection, scope revocation mid-stream, and all changes converging without duplicate/ghost markers. Browser reducers must fence old generations.

### D5. Implement advanced domains one at a time

**#34 → #35 → #36 → #37 → #38 → #39 → #40 → #41 → #42 → #43 → #44.**

Use synthetic conforming examples where permitted samples/decoders are unavailable. A protocol issue that requires an authorized real fixture remains BLOCKED for that acceptance rather than pretending synthetic data proves real decoding. Keep flight-session linkage separate from aircraft identity, reassembly finite and bounded, receiver provenance genuine, history scope/pagination correct. #44 adds useful local metrics and measured load information; it must **not** create a broker/microservice architecture without measured need.

### D6. Postpone production and hosted automation until after code feasibility

- **#45 Security threat model:** implement high-impact local security fixes before any actual public user data, even though the formal release sign-off can be later.
- **#46 Data licenses and takedown:** external approval is mandatory before any public release, may remain BLOCKED until the owner signs off.
- **#47 Retention/export/deletion:** code and local database tests can be implemented as a late engineering slice; do not fake a legal policy.
- **#48 Backup/restore:** test locally in disposable PostgreSQL and document RPO/RTO limitations.
- **#49 Hosted CI/CD:** **deferred** until the code-first milestone is accepted. Do not spend current engineering cycles fixing GitHub Actions billing or reconfiguring branches.
- **#50 Staging deployment:** **deferred** until post-MVP.
- **#51 Formal performance/soak/release qualification:** **deferred** until architecture feasibility is proven locally; short local profiling may happen earlier.
- **#52 Public release go/no-go:** **deferred**; cannot close without real rights, verified release safeguards and actual deployment evidence.

### D7. Clarifying “close issues”

There are two independent states: (a) **engineering implementation complete**, and (b) **all acceptance requirements met**. This prevents the user's GitHub list from being artificially emptied by falsely claiming external licenses or successful live data.

- `DONE / CLOSED`: merged implementation + relevant local verification + every original acceptance criterion satisfied.
- `IMPLEMENTATION VERIFIED / EXTERNAL GATE OPEN`: code is merged and locally tested; a real-source permission, actual sample, owner approval or real live/deployment test is missing. Keep the GitHub issue OPEN and label it truthfully. Continue only with separately independent engineering.
- `IN REVIEW`: code exists but tests/review or merge are pending; #17 is here now.
- `BLOCKED`: exact missing prerequisite and owner/unblock action recorded. No fabricated values, licensing, CI results or live data.

## E. Architecture and implementation recipes to reuse across tasks

### E1. Source ingestion to immutable communication fact

`provider/receiver → bounded transport → validated source delivery → permission check → source_ingestion storage + outbox (atomic) → source consumer inbox → canonical message revision + aircraft correlation + outbox (atomic) → private availability consumer inbox + contribution (atomic) → scope-qualified read model`.

A successful source ACK is not proof that the correlation and availability projections have caught up. Duplicate provider delivery with the same scoped identity returns the original accepted result; same key/different facts is a conflict. Provider-only decoded messages have no invented frame or receiver fields. Never assume a source covers all aircraft or all airframes.

### E2. Position/identity to map

`position source → validated canonical PositionObservation → append-only tracking.position_observations + outbox → temporal fleet-identity resolution → immutable position-link revision/head → current-position projector → per-aircraft map read model → bounded bbox HTTP snapshot → React/MapLibre layer`.

Keep raw observations independent from chosen identity. A changed alias can reprocess linked observations and message correlation; old observation evidence stays unchanged. Position age is determined from that observation, not the latest linked message. The map must represent UNKNOWN/stale/out-of-coverage honestly.

### E3. Availability and visible message status

For one visibility scope, derive latest eligible message from **the permitted contribution ledger**, not a global latest message row. Applying a new/retracted contribution can change either previous and new aircraft; old messages can become the fallback. The client receives status/coverage/feed health separately. No source permission means no private payload, count, status, last seen or cursor escape.

### E4. Durable snapshot + incremental WebSocket stream

A coherent snapshot includes (1) projection generation, (2) committed checkpoint from a serialized stream head, (3) rows from the same database view. The server registers/buffers changes and then replays all committed changes after the checkpoint; an uncommitted database sequence value is not an acceptable watermark. Deltas are typed `upsert/remove`, versioned per object, scope-bound; on cursor expiry, scope change, revocation or lost buffer, send `resync.required`. The client drops updates from old subscription generations and never merges two visibility scopes.

### E5. Protocol decoding and reassembly

A decoder consumes exactly the level it actually has, returns a typed result with decoder version, bearer/application layer, direction, timestamp basis and provenance. A fragment assembler needs protocol-specific key and rules, immutable fragment references, maximum bytes/fragments, expiration and `COLLECTING/COMPLETE/CONFLICTED/EXPIRED` states. VHF ACARS, HFDL and SATCOM are separate adapters; unsupported proprietary frame/RF demodulation is not invented.

### E6. Security boundary

For local prototype, the API remains bound to loopback where possible. For a future public surface, authentication produces a server-side Principal/Capability/VisibilityScope. Access policy and source publication entitlement are separate. Page state cannot override permissions. Every count, freshness color, row removal and WebSocket token must reflect current scope and revocation revision. Keep input size, worker duration, buffer depth and query bounds explicit.

### E7. Small SRP modules

Use `domain` for pure facts/policies, `application` for one use case, `ports` for dependency contracts, `infrastructure` for PG/provider/network/browser implementation, `composition` for wiring and `public/index.ts` for supported imports. Avoid `GenericRepository`, `BaseService`, orchestration in HTTP route handlers or cross-domain private imports. A new abstraction is justified by an actual shared contract, not a preference for extra files.

## F. Local implementation and verification commands — NO HOSTED CI/CD

First establish environment once from the repository root:

```bash
node --version              # Must be Node 24.x
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run check:boundaries
```

For changed pure domain rules, run the focused test (Node 24 can execute repository TypeScript imports), then the backend unit suite:

```bash
npm run check
# Or focused Node test e.g.
node --test packages/backend/tests/availability.test.mjs
```

When PostgreSQL is touched, start the local *disposable* service, migrate using migration credentials, provision a restricted runtime login **once**, and use the documented integration runner:

```bash
docker compose up -d --wait postgres
export MIGRATION_DATABASE_URL='postgresql://tv_local_admin:synthetic-local-admin-only@127.0.0.1:55432/terminal_velocity_dev'
npm run db:migrate
export RUNTIME_DATABASE_URL='postgresql://tv_local_runtime:synthetic-local-runtime-only@127.0.0.1:55432/terminal_velocity_dev'
npm run db:local-runtime
npm run test:postgres:local
```

If runtime credentials already exist, do NOT rerun provisioning blindly. If Docker is unavailable, use the existing local PostgreSQL binary harness described in `docs/POSTGRES.md`. These fixture passwords are only for the synthetic loopback dev database, not production secrets. Never use the migration user in the API runtime.

For API and message code:

```bash
STORAGE_DRIVER=postgres DATABASE_URL="$RUNTIME_DATABASE_URL" npm start
# In another terminal:
npm run example
npm run smoke
npm run test:messages
npm run test:browser
```

For newly introduced `apps/web` (not present on the current main), define package-local scripts and document exact Vite/dev commands in the issue. Verify the UI with a local API and mocked/synthetic data. Test viewport selection, inaccessible tiles, empty states, status freshness, reconnection and mobile layout. Avoid public source-driven browser E2E until rights are established.

**Evidence table to paste into every issue/PR**:

| Gate | Command | Environment | Result | Notes |
|---|---|---|---|---|
| Type correctness | `npm run typecheck` | Node 24, TS version | PASS / FAIL / NOT RUN | errors/fixes |
| Boundaries | `npm run check:boundaries` | Node 24 | PASS / FAIL / NOT RUN | violated imports |
| Changed behavior | focused Node tests | Node 24 | N passed, N failed | negative scenarios |
| Data durability | `npm run test:postgres:local` | real local PG | N passed, N failed | versions/migration |
| Browser/API | smoke/Playwright/route test | local | N passed, N failed | actual observable result |
| Hosted GitHub Actions | **DEFERRED** | not executed | NOT RUN | not a release claim |

**Do not equate “remote CI not running” with a failing business rule**. Also do not equate “I read the test code” with tests passing. A local code merge is permitted by the owner's code-first workflow only when its relevant execution gates are demonstrably satisfied or an explicit risk exception is recorded in the issue.

## G. Executable MVP sign-off scenarios

**G1 — memory-only baseline:** run API, list three synthetic aircraft, POST one example message and replay it; verify created/duplicate behavior, 409 on conflicting reused ID, correct freshness from observedAt and clean SIGTERM.

**G2 — durable restart:** run PostgreSQL, accept synthetic message; verify stored fact immediately and projected availability after drain; kill/restart API/worker; retry same input, verify no extra outbox/inbox/availability effect and no reappearance of revoked/tombstoned contributions.

**G3 — aircraft position:** ingest bounded synthetic position series for one aircraft and one ambiguous identifier; verify immutable position history, temporal identity, correct current position chosen by observation time/quality; simulate older arrival after newer; independent stale position and RECENT communication.

**G4 — browser map:** open the local web app, see markers from HTTP bbox snapshot; pan/zoom, select aircraft, see observed track segments with gaps, message timeline, status, coverage and source health; try rapid viewport changes, empty viewport, missing tiles and mobile width.

**G5 — security and realtime (after Stage5):** public/owner principals view the same aircraft with different message grants; the public user must not infer a hidden new message from counts, marker color, last seen or stream deltas. Revoke while connected, disconnect/reconnect, and verify a fresh snapshot converges.

**G6 — advanced replay:** two consecutive flight sessions for one aircraft, ambiguous flight link, out-of-order fragment assembly, station with zero RF traffic but healthy heartbeat, unknown protocol, deterministic paginated history and correction reprocessing.

**G7 — production gates (LATER):** separate permission/signoff, deletion/retention policy, restore drill, secure deployment, remote CI, performance qualification and controlled launch. None of these is prerequisite for assessing the local synthetic MVP, but some are mandatory before exposing real/public data.

## H. Ordered GitHub issue checklist (live issue statuses as of snapshot)

The following table describes **GitHub issue state at creation time**, not a promise that future agents can omit reconciliation. The detailed task specification follows immediately after the table.


| Order | Issue / original title | GitHub status | Code-first disposition |
|---:|---|---|---|
| 01 | [#5](https://github.com/ppotepa/terminal-velocity/issues/5) [S3-01] Define versioned source-observation contracts and capability descriptors | DONE | Reuse; already closed |
| 02 | [#6](https://github.com/ppotepa/terminal-velocity/issues/6) [S3-02] Select one lawful message source and record access/publication decision | EXTERNAL GATE / BLOCKED | Retain software; wait for authorized real acceptance; independent code may continue |
| 03 | [#7](https://github.com/ppotepa/terminal-velocity/issues/7) [S3-03] Persist provider deliveries and provenance using a new PostgreSQL migration | DONE | Reuse; already closed |
| 04 | [#8](https://github.com/ppotepa/terminal-velocity/issues/8) [S3-04] Implement atomic source-delivery acceptance and scoped idempotency | DONE | Reuse; already closed |
| 05 | [#9](https://github.com/ppotepa/terminal-velocity/issues/9) [S3-05] Implement the selected provider transport with bounded resource budgets | EXTERNAL GATE / BLOCKED | Retain software; wait for authorized real acceptance; independent code may continue |
| 06 | [#10](https://github.com/ppotepa/terminal-velocity/issues/10) [S3-06] Normalize provider payloads and preserve actual observation granularity | EXTERNAL GATE / BLOCKED | Retain software; wait for authorized real acceptance; independent code may continue |
| 07 | [#11](https://github.com/ppotepa/terminal-velocity/issues/11) [S3-07] Connect canonical source observations to the durable message pipeline | EXTERNAL GATE / BLOCKED | Retain software; wait for authorized real acceptance; independent code may continue |
| 08 | [#12](https://github.com/ppotepa/terminal-velocity/issues/12) [S3-08] Implement bounded source replay, quarantine and operational health | DONE | Reuse; already closed |
| 09 | [#13](https://github.com/ppotepa/terminal-velocity/issues/13) [S3-09] Verify one authorized live-source end-to-end private integration | EXTERNAL GATE / BLOCKED | Retain software; wait for authorized real acceptance; independent code may continue |
| 10 | [#14](https://github.com/ppotepa/terminal-velocity/issues/14) [S4-01] Define validated position observations and adapter contracts | DONE | Reuse; already closed |
| 11 | [#15](https://github.com/ppotepa/terminal-velocity/issues/15) [S4-02] Integrate one authorized ADS-B/MLAT source transport and parser | EXTERNAL GATE / BLOCKED | Retain software; wait for authorized real acceptance; independent code may continue |
| 12 | [#16](https://github.com/ppotepa/terminal-velocity/issues/16) [S4-03] Persist append-only position history with spatial indexes | DONE | Reuse; already closed |
| 13 | [#17](https://github.com/ppotepa/terminal-velocity/issues/17) [S4-04] Implement temporal aircraft identity registry and position linkage | IN REVIEW | Finish draft PR #66 and verify latest migration locally |
| 14 | [#18](https://github.com/ppotepa/terminal-velocity/issues/18) [S4-05] Maintain the current-position projection with independent freshness | BACKLOG | Implement sequentially after preceding eligible code task |
| 15 | [#19](https://github.com/ppotepa/terminal-velocity/issues/19) [S4-06] Build observed flight-track history and map-scale simplification | BACKLOG | Implement sequentially after preceding eligible code task |
| 16 | [#20](https://github.com/ppotepa/terminal-velocity/issues/20) [S4-07] Create a scoped bbox map projection and coherent HTTP snapshot | BACKLOG | Implement sequentially after preceding eligible code task |
| 17 | [#21](https://github.com/ppotepa/terminal-velocity/issues/21) [S4-08] Establish the minimal React frontend shell and shared design primitives | BACKLOG | Implement sequentially after preceding eligible code task |
| 18 | [#22](https://github.com/ppotepa/terminal-velocity/issues/22) [S4-09] Implement MapLibre viewport, aircraft markers and observed tracks | BACKLOG | Implement sequentially after preceding eligible code task |
| 19 | [#23](https://github.com/ppotepa/terminal-velocity/issues/23) [S4-10] Build aircraft details, message timeline, flight list and filters | BACKLOG | Implement sequentially after preceding eligible code task |
| 20 | [#24](https://github.com/ppotepa/terminal-velocity/issues/24) [S4-11] Verify the private live-map MVP end to end | BACKLOG | Implement sequentially after preceding eligible code task |
| 21 | [#25](https://github.com/ppotepa/terminal-velocity/issues/25) [S5-01] Define source entitlements and versioned publication-policy decisions | BACKLOG | Implement sequentially after preceding eligible code task |
| 22 | [#26](https://github.com/ppotepa/terminal-velocity/issues/26) [S5-02] Implement principal resolution, roles and authenticated API boundaries | BACKLOG | Implement sequentially after preceding eligible code task |
| 23 | [#27](https://github.com/ppotepa/terminal-velocity/issues/27) [S5-03] Persist visibility scopes, grants and independent publication revisions | BACKLOG | Implement sequentially after preceding eligible code task |
| 24 | [#28](https://github.com/ppotepa/terminal-velocity/issues/28) [S5-04] Build privacy-safe, scope-qualified message and map projections | BACKLOG | Implement sequentially after preceding eligible code task |
| 25 | [#29](https://github.com/ppotepa/terminal-velocity/issues/29) [S5-05] Propagate permission revocations as contribution tombstones and removals | BACKLOG | Implement sequentially after preceding eligible code task |
| 26 | [#30](https://github.com/ppotepa/terminal-velocity/issues/30) [S5-06] Persist an ordered map snapshot checkpoint and incremental change log | BACKLOG | Implement sequentially after preceding eligible code task |
| 27 | [#31](https://github.com/ppotepa/terminal-velocity/issues/31) [S5-07] Implement authorized WebSocket subscriptions with snapshot/replay barrier | BACKLOG | Implement sequentially after preceding eligible code task |
| 28 | [#32](https://github.com/ppotepa/terminal-velocity/issues/32) [S5-08] Implement client snapshot/delta reducer and reconnect lifecycle | BACKLOG | Implement sequentially after preceding eligible code task |
| 29 | [#33](https://github.com/ppotepa/terminal-velocity/issues/33) [S5-09] Verify publication safety and realtime reliability end to end | BACKLOG | Implement sequentially after preceding eligible code task |
| 30 | [#34](https://github.com/ppotepa/terminal-velocity/issues/34) [S6-01] Model versioned flight sessions and uncertain flight boundaries | BACKLOG | Implement sequentially after preceding eligible code task |
| 31 | [#35](https://github.com/ppotepa/terminal-velocity/issues/35) [S6-02] Implement independent Message-to-FlightSession correlation | BACKLOG | Implement sequentially after preceding eligible code task |
| 32 | [#36](https://github.com/ppotepa/terminal-velocity/issues/36) [S6-03] Implement bounded protocol fragment reassembly and message revisions | BACKLOG | Implement sequentially after preceding eligible code task |
| 33 | [#37](https://github.com/ppotepa/terminal-velocity/issues/37) [S6-04] Add receiver station onboarding and authenticated feeder intake | BACKLOG | Implement sequentially after preceding eligible code task |
| 34 | [#38](https://github.com/ppotepa/terminal-velocity/issues/38) [S6-05] Compute station health and scoped coverage without overclaiming reception | BACKLOG | Implement sequentially after preceding eligible code task |
| 35 | [#39](https://github.com/ppotepa/terminal-velocity/issues/39) [S6-06] Build versioned protocol-stack decoder registry and extension contract | BACKLOG | Implement sequentially after preceding eligible code task |
| 36 | [#40](https://github.com/ppotepa/terminal-velocity/issues/40) [S6-07] Implement and validate VHF ACARS message decoding adapter | BACKLOG | Implement sequentially after preceding eligible code task |
| 37 | [#41](https://github.com/ppotepa/terminal-velocity/issues/41) [S6-08] Implement and validate HFDL observations through the decoder registry | BACKLOG | Implement sequentially after preceding eligible code task |
| 38 | [#42](https://github.com/ppotepa/terminal-velocity/issues/42) [S6-09] Implement and validate SATCOM observations through the decoder registry | BACKLOG | Implement sequentially after preceding eligible code task |
| 39 | [#43](https://github.com/ppotepa/terminal-velocity/issues/43) [S6-10] Add bounded history search and cursor pagination across flight/messages | BACKLOG | Implement sequentially after preceding eligible code task |
| 40 | [#44](https://github.com/ppotepa/terminal-velocity/issues/44) [S6-11] Instrument aviation data quality and decide scaling from measured load | BACKLOG | Implement sequentially after preceding eligible code task |
| 41 | [#45](https://github.com/ppotepa/terminal-velocity/issues/45) [REL-01] Complete an application threat model and close high-priority security gaps | BACKLOG | Late engineering and governance; release signoff later |
| 42 | [#46](https://github.com/ppotepa/terminal-velocity/issues/46) [REL-02] Approve data licenses, privacy handling and source takedown workflow | BACKLOG | Late engineering and governance; release signoff later |
| 43 | [#47](https://github.com/ppotepa/terminal-velocity/issues/47) [REL-03] Implement audited retention, export and deletion lifecycle for stored data | BACKLOG | Late engineering and governance; release signoff later |
| 44 | [#48](https://github.com/ppotepa/terminal-velocity/issues/48) [REL-04] Implement and drill PostgreSQL backup, recovery and migration rollback | BACKLOG | Late engineering and governance; release signoff later |
| 45 | [#49](https://github.com/ppotepa/terminal-velocity/issues/49) [REL-05] Restore GitHub Actions and require passing CI as a merge/release gate | BACKLOG | LATER / no CI-CD or deployment in prototype phase |
| 46 | [#50](https://github.com/ppotepa/terminal-velocity/issues/50) [REL-06] Provision staging deployment with health, secrets and safe rollback | BACKLOG | LATER / no CI-CD or deployment in prototype phase |
| 47 | [#51](https://github.com/ppotepa/terminal-velocity/issues/51) [REL-07] Execute representative load, soak and failure-injection qualification | BACKLOG | LATER / no CI-CD or deployment in prototype phase |
| 48 | [#52](https://github.com/ppotepa/terminal-velocity/issues/52) [REL-08] Run final production go/no-go review and controlled launch | BACKLOG | LATER / no CI-CD or deployment in prototype phase |

---

# Detailed issue-by-issue execution packets

## 01. [#5] Define versioned source-observation contracts and capability descriptors

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/5  
**Phase:** Stage 3 · Source contracts and private ingestion  
**Snapshot status:** DONE · **Dependency:** Merged Stage2 baseline  
**Execution policy:** Already merged and closed; use as tested contract/reference.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 01 · **Stage:** 3 — Real message connector · **Status:** DONE
> **Depends on:** Merged baseline PR #3. **Do not start until dependency is complete.**

### Objective and delivered result
A single typed boundary represents provider deliveries without confusing a decoded message with an RF reception or transmitted frame.

### Exact implementation steps
1. Define discriminated observations for `PROVIDER_MESSAGE`, `FRAME`, and `RECEPTION`; do not invent fields absent from the provider.
2. Create `SourceId`, `ExternalDeliveryId`, `ObservationTimeEvidence` (observed/received/provider/ingested, precision and uncertainty), source capabilities and sampling declarations with validated factories.
3. Define `SourceAdapter<Raw, Canonical>` or equivalent narrowly typed parser interface with `Result` errors and schema-versioned input; separate transport and normalization ports.
4. Document identifier stability, message direction, bearer vs protocol stack, and whether complete receiver coverage is known.
5. Expose contracts only through public exports and enforce domain-layer import restrictions.

### Ownership / intended files
`packages/backend/src/modules/source-connectors/{domain,application,ports,public}` and contracts; `docs/SOURCES.md`.

### Verification plan
- Pure unit tests for each input level, missing metadata, invalid timestamps, unsupported versions, and incomplete coverage.
- `npm run check` including architecture boundary checks.

### Acceptance criteria (check as completed)
- Typed models distinguish delivery, real reception, frame, and provider message.
- No synthetic station/frame is created for message-only input.
- Documented schemas and tests are merged.
- Merged PR linked; passing checks, actual commands/results and limitations recorded below.

### Out of scope
No provider network connection, database migration, or publishing of source content.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Repository baseline and prerequisite inspection
- Start at current `main`; inspect `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/architecture/ARCHITECTURE_V2.md`, the predecessor issue and merged PR. Inspect path names in the repository; paths marked 'proposed' must be created and exported through bounded public entry points.
- Existing implementation touchpoints (read before editing): `packages/backend/src/kernel/result.ts`, `kernel/brand.ts`, `kernel/time/epoch-millis.ts`, `contracts/identity/index.ts`, `scripts/architecture/policy.mjs`, `docs/architecture/ARCHITECTURE_V2.md`.
- Target code/docs (new unless already present): `packages/backend/src/modules/source-connectors/domain/{source-id,observation-level,time-evidence,capability-descriptor,normalized-observation}.ts`, `ports/source-observation-parser.ts`, `public/index.ts` (proposed; adapt only for actual ownership).
- The existing backend is TypeScript/Node 24 workspaces, with PostgreSQL migrations; there is **no real provider integration or web app yet**. Do not treat proposed paths as pre-existing files.

#### Concrete contract and data shape
Define a tagged union: `kind: PROVIDER_MESSAGE | FRAME_OBSERVATION | RECEIVER_RECEPTION`. Common fields: `sourceId`, `sourceDeliveryId`, `receivedAt`, `observedAt?: TimeEvidence`, `decoderVersion?: string`, `payloadDigest`, `capabilitiesRevision`. Provider-only variant must not require `stationId`, RF bytes or frequency. Provide parser returning `Result<CanonicalObservation, SourceParseError>`; `SourceParseError` discriminates INVALID_INPUT, UNSUPPORTED_VERSION, MISSING_REQUIRED_EVIDENCE.

#### Implementation algorithm / sequencing
Validate external JSON at the boundary, normalize immutable primitives, preserve timestamp basis and unknown fields only as safe raw evidence when licensed. Return an explicit source coverage descriptor (`UNKNOWN`, `SAMPLED`, `STATION_SCOPED`) independent of health. Never interpret `VDL2` as proof of ACARS application decoding.

#### Required negative and integration tests
Table-driven valid variants, missing station for provider-only accepted, fabricated RF metadata rejected, malformed ICAO/time rejected, unknown schema version typed error; AST import check.

#### Handoff artifact / dependency to next issue
Define ABI/exports for S3-03 storage and S3-06 parser. No network or DB adapter.

#### Agent work protocol and review evidence
1. Confirm predecessor DONE and the currently checked-out branch. Update this issue's **existing status log** to IN PROGRESS, with UTC timestamp, owner, branch, planned touched paths and constraints before writing code.
2. Define types and narrow ports first; implement pure domain validation next, then provider/SQL adapters, application orchestration and composition. Reuse `Result<T,E>`, typed IDs and `runSqlTransaction<T>` where their guarantees match. No generic BaseService or cross-domain private imports.
3. Treat actual observation time, source capability/coverage and publication eligibility as independent facts. Never fake decoded/RF data, a station, a flight session, authorization or remote CI success.
4. Run `npm run check`, real PostgreSQL integration suite when SQL changes, and issue-specific tests listed above. Report **exact commands and pass/fail numbers**. For blocked credentials or real-source permission, change status to BLOCKED with an actionable unblock condition; do not deliver a simulated provider test as a live verification.
5. Open one focused PR referencing this issue; update IN REVIEW, check acceptance boxes only on verified behavior, attach merged SHA, architectural impact, migration/rollback notes and evidence. Mark DONE/close only after merge, then update EPIC #4 counts/checklist and set the next issue READY.

#### Definition of implementation completeness
No TODO-only stubs or fictitious data labeled 'live'. Pure policies have unit tests; external formats have recorded/redacted contract fixtures; persistence uses real PostgreSQL concurrency/rollback tests when applicable. Any unfulfilled criterion remains unchecked and blocks completion.

### Agent implementation blueprint (2026-11-19)

> **Repo grounding:** compared with `main` at commit `373a2755`. Paths listed as **create** are proposed, not existing. The issue body above remains the authoritative objective and acceptance checklist. **Work only on this issue when its predecessor is DONE.**

#### Existing code to inspect before editing
- `packages/backend/src/kernel/{result.ts,brand.ts,time/epoch-millis.ts}`
- `packages/backend/src/contracts/identity/index.ts`
- `packages/backend/src/demo/application/parse-message-input.ts`
- `scripts/architecture/policy.mjs`

#### Proposed file-by-file ownership (create only what is needed)
- `packages/backend/src/modules/source-connectors/domain/{source-id.ts,source-delivery-id.ts,observation-time-evidence.ts,source-observation.ts,source-capabilities.ts}`
- `packages/backend/src/modules/source-connectors/ports/source-parser.ts`
- `packages/backend/src/modules/source-connectors/public/index.ts`
- `packages/backend/tests/source-observation.test.mjs`
- `docs/SOURCES.md`

#### Concrete contracts and invariants
1. Use a discriminated union with `dataLevel: 'PROVIDER_MESSAGE' | 'RECEPTION' | 'FRAME'` and a stable `SourceDeliveryIdentity` tuple `(provider, accountScope, sourceEpoch, externalId)`. The DTO MUST carry `receivedAt`, optional `observedAt` with precision/uncertainty and provenance; parser input is `unknown`.
2. A provider-message variant may include decoded text and address hints but MUST NOT require `receiverId`, `frequencyHz`, frame bytes or a fabricated RF frame. A reception variant requires real receiver provenance; frame-only inputs require actual frame evidence.
3. Expose `SourceParser<TRaw, TCanonical, TFailure>.parse(raw): Result<TCanonical, TFailure>` and explicit errors `INVALID_INPUT`, `UNKNOWN_SCHEMA`, `MISSING_TIME`, `UNSUPPORTED_LEVEL` (suggested names). Keep runtime validation in factories; branded types are not validation.

#### Agent implementation order
- **Step 1.** Read the existing branded ID and Result patterns, then decide which source identifiers belong in `contracts/` versus the new module; IDs remain opaque and must be parsed at intake.
- **Step 2.** Implement small pure functions for source identity parsing, time evidence validation, bearer/protocol differentiation, input-level selection, and capability construction.
- **Step 3.** Write the source observation union and freeze/clone caller-owned nested objects when storing evidence; add source-level invariants without Node/pg imports.
- **Step 4.** Add a public `index.ts` exposing only stable types and pure parsers; verify no deep imports through the AST boundary checker.
- **Step 5.** Document examples of all three data levels, provider timestamp semantics, retryable vs nonretryable errors and how `S3-02` chooses a provider.

#### Test matrix / executable verification
- Unit test a message-only provider example: decoded content and source, no receiver/frequency/raw frame keys.
- Reject malformed ID, non-UTC timestamp, invalid uncertainty, unknown data level, impossible future observation and conflicting clock evidence; distinguish absent vs zero.
- Make two separate physical receptions legal even when decoded text is identical; verify result types are discriminated without `as any`.
- Execute `npm run check` and ensure the new module appears in architecture discovery without relaxing domain import rules.

#### Handoff constraints
Pure contracts only. Do not edit `db/migrations/001_durable_correlation.sql`, introduce provider credentials, or claim network access. Stage3-02 selects the provider; keep the first issue entirely offline.

#### Final evidence checklist for this issue
- Confirm only this scope changed, update the existing acceptance boxes and record the actual branch, PR, merged SHA and migration number (if any).
- Record commands **actually run** and pass/fail/skip results in the issue status log; GitHub Actions not running is **not** a pass.
- Document any source rights/credentials limitation and update `docs/IMPLEMENTATION_STATUS.md` only where implementation status truly changed.
- Close this issue after merge and verified acceptance; check it in #4 and activate the next issue; do not implement the next issue here.


---

## 02. [#6] Select one lawful message source and record access/publication decision

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/6  
**Phase:** Stage 3 · Source contracts and private ingestion  
**Snapshot status:** EXTERNAL GATE / BLOCKED · **Dependency:** Issue #5 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Engineering artifact may be merged, but leave issue open until all external original acceptance criteria are proven.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 02 · **Stage:** 3 — Real message connector · **Status:** BLOCKED
> **Depends on:** #5 (DONE, merged and verified). **Do not start until dependency is complete.**

### Message acquisition strategy

Select the exact message page and document its URL, visible fields, pagination, access conditions, allowed crawl rate, retention and fixture use. Review the site terms and crawler directives. Record an allowed, redacted page sample and its provenance. A provider API account is deferred. The owner has selected the crawl strategy; the target is Airframes Live Messages.

The owner selected [Airframes Live Messages](https://app.airframes.io/messages/live). The initial HTML contains the JavaScript application shell. Airframes documents filters for registration, flight, text and label and identifies reception time and feeder where supplied. Anonymous filter availability and actual row fields still need verification in the rendered view. The generic robots rules allow the live page. The API licensing page describes API use and its terms link returned 404. Evidence for automated website collection, retention, private display and a permitted redacted fixture is outstanding. See [usage guide](https://docs.airframes.io/docs/using-airframes/), [robots directives](https://app.airframes.io/robots.txt) and [licensing](https://docs.airframes.io/api/licensing/).

### Objective and delivered result
A source is selected based on documented access rights and actual data granularity, not assumptions about Airframes or SDR APIs.

### Exact implementation steps
1. Evaluate the selected website for message fields, source timestamps, pagination, crawl limits, retention and redistribution rights. Keep prior API and receiver research as background.
2. Verify current source documentation/terms and record links, review date, account-level restrictions and whether permission for private ingestion and public display differs.
3. Select a specific first adapter and acquisition mode; record precise authorized purpose, exclusions, fallback and contact/approval required.
4. Identify source credentials, fixture acquisition method and a privacy-safe sample for contract tests. Do not put secrets or private RF content in Git.
5. Define a `go/no-go` decision: if rights or access are unverified, mark this issue BLOCKED and do not proceed to the provider integration.

### Ownership / intended files
`docs/adr/` source-selection ADR and `docs/SOURCES.md`.

### Verification plan
- ADR review with an explicit rights checklist, website crawl constraints, sample provenance and approved private/public scopes.

### Acceptance criteria (check as completed)
- One source and endpoint/transport are named with documented authorized usage.
- A permitted, redacted example is available or the issue accurately remains BLOCKED.
- Non-supported sharing/publication is explicitly prohibited.
- Merged PR linked; passing checks, actual commands/results and limitations recorded below.

### Out of scope
Implement the approved crawler in #9, circumvent access controls, or interpret reception absence as no transmission.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Repository baseline and prerequisite inspection
- Start at current `main`; inspect `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/architecture/ARCHITECTURE_V2.md`, the predecessor issue and merged PR. Inspect path names in the repository; paths marked 'proposed' must be created and exported through bounded public entry points.
- Existing implementation touchpoints (read before editing): `docs/ROADMAP.md`, `docs/architecture/ARCHITECTURE_V2.md` sections 4/7/8, `docs/API.md`, Stage3 #5 contract.
- Target code/docs (new unless already present): `docs/adr/ADR-source-selection.md`, `docs/SOURCES.md`, redacted example manifest (not forbidden payload).
- The existing backend is TypeScript/Node 24 workspaces, with PostgreSQL migrations; there is **no real provider integration or web app yet**. Do not treat proposed paths as pre-existing files.

#### Concrete contract and data shape
Decision record must include `provider`, `transport`, `dataLevel`, `approvedUse: internal/public/denied`, `contract/terms URL`, `verifiedOn`, `quota`, `fieldRights`, `retention`, `credentialOwner`, `redactedFixtureSource`, `goNoGo`.

#### Implementation algorithm / sequencing
Examine the selected message website; verify whether current authentication, full sampling, redistribution, and station ownership permit the exact planned usage. Differentiate availability of an API from legal permission to ingest/store/publish. Record a fallback source only if fully specified and authorized.

#### Required negative and integration tests
Human-verifiable source links and explicit private/public rights matrix; confirm sample has no secrets or sensitive messages; mark BLOCKED if access/rights uncertain.

#### Handoff artifact / dependency to next issue
Provider identity, immutable delivery key semantics, actual source payload structure and quota supply S3-03–S3-06. Do not write a speculative connector.

#### Agent work protocol and review evidence
1. Confirm predecessor DONE and the currently checked-out branch. Update this issue's **existing status log** to IN PROGRESS, with UTC timestamp, owner, branch, planned touched paths and constraints before writing code.
2. Define types and narrow ports first; implement pure domain validation next, then provider/SQL adapters, application orchestration and composition. Reuse `Result<T,E>`, typed IDs and `runSqlTransaction<T>` where their guarantees match. No generic BaseService or cross-domain private imports.
3. Treat actual observation time, source capability/coverage and publication eligibility as independent facts. Never fake decoded/RF data, a station, a flight session, authorization or remote CI success.
4. Run `npm run check`, real PostgreSQL integration suite when SQL changes, and issue-specific tests listed above. Report **exact commands and pass/fail numbers**. For blocked credentials or real-source permission, change status to BLOCKED with an actionable unblock condition; do not deliver a simulated provider test as a live verification.
5. Open one focused PR referencing this issue; update IN REVIEW, check acceptance boxes only on verified behavior, attach merged SHA, architectural impact, migration/rollback notes and evidence. Mark DONE/close only after merge, then update EPIC #4 counts/checklist and set the next issue READY.

#### Definition of implementation completeness
No TODO-only stubs or fictitious data labeled 'live'. Pure policies have unit tests; external formats have recorded/redacted contract fixtures; persistence uses real PostgreSQL concurrency/rollback tests when applicable. Any unfulfilled criterion remains unchecked and blocks completion.

### Agent implementation blueprint (2026-11-19)

> **Repo grounding:** compared with `main` at commit `373a2755`. Paths listed as **create** are proposed, not existing. The issue body above remains the authoritative objective and acceptance checklist. **Work only on this issue when its predecessor is DONE.**

#### Existing code to inspect before editing
- `docs/ROADMAP.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `docs/architecture/ARCHITECTURE_V2.md`
- `AGENTS.md`

#### Proposed file-by-file ownership (create only what is needed)
- `docs/adr/0001-first-message-source.md`
- `docs/SOURCES.md (update the contract guide from #5)`
- `tests/fixtures/providers/<approved-source>/README.md (metadata only, unless a permitted redacted fixture exists)`

#### Concrete contracts and invariants
1. The decision record must identify the exact provider, account/feed tier, authorized endpoint or feeder transport, scopes (internal ingestion, storage, derived counters, public publication), payload granularity and frequency/latency guarantees as stated by the provider.
2. For each capability record `provenance field → canonical field`, ID stability and replay behavior, availability of real receiver/time evidence, contractual quotas, attribution, redistribution constraints and retention window.
3. Decision outcome is explicitly `APPROVED_PRIVATE_ONLY`, `APPROVED_FOR_PUBLIC_FIELDS` or `BLOCKED_PENDING_RIGHTS` with reviewer/date/evidence; **API access is not redistribution permission**.

#### Agent implementation order
- **Step 1.** Verify the terms and crawler directives for the selected message page. Link exact versions/dates rather than paraphrased assumptions; do not infer permissions from public website examples.
- **Step 2.** Produce a comparison matrix (auth, message level, sample feed completeness, stability of IDs, rate limits, recovery, storage/license, owner/contact) and justify one selected option.
- **Step 3.** Record a provenance-preserving *sanitized* fixture creation procedure. If the source forbids redistribution, test data stays outside Git and code uses synthetic structurally equivalent fixtures.
- **Step 4.** Document required environment variable names (not values), onboarding steps and approved region/time window; specify how to revoke access and halt the connector.
- **Step 5.** Set a verifiable go/no-go condition; if access/licensing or a lawful sample is unavailable, update THIS issue to BLOCKED, name the person/approval needed and leave S3-03 unstarted.

#### Test matrix / executable verification
- Peer review the rights matrix and the exact documented feed shape, recording URLs and review date.
- Validate that the intended downstream source data level matches the #5 union and that none of the fields are inferred.
- Confirm no API keys, raw messages or private station positions appear in repo/PR; link reviewer sign-off.

#### Handoff constraints
This is a documentation/governance issue. Do not implement an unapproved API client to force progress. A BLOCKED issue prevents the sequenced next issue by project policy.

#### Final evidence checklist for this issue
- Confirm only this scope changed, update the existing acceptance boxes and record the actual branch, PR, merged SHA and migration number (if any).
- Record commands **actually run** and pass/fail/skip results in the issue status log; GitHub Actions not running is **not** a pass.
- Document any source rights/credentials limitation and update `docs/IMPLEMENTATION_STATUS.md` only where implementation status truly changed.
- Close this issue after merge and verified acceptance; check it in #4 and activate the next issue; do not implement the next issue here.


---

## 03. [#7] Persist provider deliveries and provenance using a new PostgreSQL migration

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/7  
**Phase:** Stage 3 · Source contracts and private ingestion  
**Snapshot status:** DONE · **Dependency:** Issue #6 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Already merged and closed; use as tested contract/reference.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 03 · **Stage:** 3 — Real message connector · **Status:** DONE
> **Engineering base:** PR #55 merged and verified. #6 gates real payload retention. Implement storage against synthetic fixtures.

### Message acquisition strategy

Store crawl provenance for each accepted record: source page URL without sensitive parameters, retrieval time, parser version and source delivery identity. Keep retrieval time separate from observation time. Retain page content only within the scope established in #6.

### Objective and delivered result
Each accepted provider delivery is stored durably with exact origin and data level before downstream processing.

### Exact implementation steps
1. Add provider/source tables for delivery keys, source/decoder version, timestamps, data level, stable external IDs, payload checksum and quarantine reason.
2. Define separate optional provider-message observations and actual receiver reception references; no required fake station ID.
3. Use a uniqueness scope justified by the provider contract: account, source, session or receiver when IDs may be reused.
4. Add a restricted owner/runtime permission design compatible with Stage2; do not alter earlier applied migration files.
5. Store raw payload only when rights permit it; otherwise store permitted parsed facts and a checksum, with declared retention.

### Ownership / intended files
`db/migrations/002_*.sql`; source-ingestion storage ports and SQL adapter.

### Verification plan
- Real PostgreSQL migration/grants tests and restart durability.
- Conflicting same-key/different-content cases, null RF metadata for provider-only messages, invalid time and payload-level checks.

### Acceptance criteria (check as completed)
- Migration is versioned and idempotent under the existing migrator.
- Source provenance is queryable and protected by constrained runtime grants.
- Real-DB integration tests pass.
- Merged PR linked; passing checks, actual commands/results and limitations recorded below.

### Out of scope
No connector transport or correlation modifications yet.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Repository baseline and prerequisite inspection
- Start at current `main`; inspect `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/architecture/ARCHITECTURE_V2.md`, the predecessor issue and merged PR. Inspect path names in the repository; paths marked 'proposed' must be created and exported through bounded public entry points.
- Existing implementation touchpoints (read before editing): `db/migrations/001_durable_correlation.sql`, `scripts/postgres/migrate.mjs`, `packages/backend/src/contracts/database/index.ts`, `docs/POSTGRES.md`.
- Target code/docs (new unless already present): `db/migrations/002_source_deliveries.sql`, source-ingestion SQL read/write adapters and schema verification.
- The existing backend is TypeScript/Node 24 workspaces, with PostgreSQL migrations; there is **no real provider integration or web app yet**. Do not treat proposed paths as pre-existing files.

#### Concrete contract and data shape
Suggested `source_ingestion.deliveries`: `(source_id, external_scope, external_delivery_id)` UNIQUE if supported by provider, SHA-256 digest, data_level, observed_at/received_at with explicit basis, provenance JSONB validated, payload_reference optional, state and version. Separate optional `receptions` keyed by real receiver evidence; do not create station row for provider-only message.

#### Implementation algorithm / sequencing
Write additive SQL migration with role/schema owner and runtime grants; ensure migration CLI checksums remain immutable and no code changes historical migration. Implement `appendDelivery` only using injected SqlExecutor in bounded transactions. Keep provider-specific keys opaque and validated.

#### Required negative and integration tests
On real PG: first-write collision, two source IDs same external ID, same key/different digest conflict, missing RF fields accepted for provider message, runtime cannot DELETE historical rows.

#### Handoff artifact / dependency to next issue
Document exact created tables/indexes and resulting SQL contracts for S3-04. Migration requires privileged runner, never API.

#### Agent work protocol and review evidence
1. Confirm the merged engineering base identified above and the currently checked-out branch. Update this issue's **existing status log** to IN PROGRESS, with UTC timestamp, owner, branch, planned touched paths and constraints before writing code.
2. Define types and narrow ports first; implement pure domain validation next, then provider/SQL adapters, application orchestration and composition. Reuse `Result<T,E>`, typed IDs and `runSqlTransaction<T>` where their guarantees match. No generic BaseService or cross-domain private imports.
3. Treat actual observation time, source capability/coverage and publication eligibility as independent facts. Never fake decoded/RF data, a station, a flight session, authorization or remote CI success.
4. Run `npm run check`, real PostgreSQL integration suite when SQL changes, and issue-specific tests listed above. Report **exact commands and pass/fail numbers**. For blocked credentials or real-source permission, change status to BLOCKED with an actionable unblock condition; do not deliver a simulated provider test as a live verification.
5. Open one focused PR referencing this issue; update IN REVIEW, check acceptance boxes only on verified behavior, attach merged SHA, architectural impact, migration/rollback notes and evidence. Mark DONE/close only after merge, then update EPIC #4 counts/checklist and set the next issue READY.

#### Definition of implementation completeness
No TODO-only stubs or fictitious data labeled 'live'. Pure policies have unit tests; external formats have recorded/redacted contract fixtures; persistence uses real PostgreSQL concurrency/rollback tests when applicable. Any unfulfilled criterion remains unchecked and blocks completion.

### Agent implementation blueprint (2026-11-19)

> **Repo grounding:** compared with `main` at commit `373a2755`. Paths listed as **create** are proposed, not existing. The issue body above remains the authoritative objective and acceptance checklist. Use the #4 coordinator decision for this synthetic-only storage slice.

#### Existing code to inspect before editing
- `db/migrations/001_durable_correlation.sql`
- `scripts/postgres/migrate.mjs`
- `scripts/postgres/run-integration.mjs`
- `packages/backend/src/contracts/database/sql-executor.ts`
- `packages/backend/tests/integration/migrations-and-permissions.test.mjs`

#### Proposed file-by-file ownership (create only what is needed)
- `db/migrations/002_source_delivery.sql (or the next available numbered migration; never change 001)`
- `packages/backend/src/modules/source-connectors/ports/source-delivery-store.ts`
- `packages/backend/src/modules/source-connectors/infrastructure/postgres/{source-delivery-rows.ts,postgres-source-delivery-store.ts}`
- `packages/backend/tests/integration/source-delivery-schema.test.mjs`

#### Concrete contracts and invariants
1. Suggested `source_ingestion.source_deliveries`: `delivery_id` (internal PK), `provider_id`, `account_scope`, `source_epoch`, `external_id`, `payload_sha256`, `data_level`, `schema_version`, `source_observed_at_ms NULL`, `received_at_ms`, `ingested_at_ms`, `provenance JSONB` and state. Enforce uniqueness of `(provider_id,account_scope,source_epoch,external_id)` only when the selected provider guarantees ID stability.
2. Create `source_ingestion.provider_message_observations` with FK to delivery and optional canonical decoded content references. Create `source_ingestion.receptions` only for real receiver events with actual station/receiver identity; no mandatory RF columns on provider-only rows.
3. For later atomic events, introduce a **source-owned append-only `source_ingestion.outbox`** (event IDs, scoped stream key/revision, payload, fanout marker) but do not pretend Stage2 `event_delivery.deliveries` can reference it yet: that table currently has a FK to `correlation.outbox`. S3-07 must explicitly bridge this boundary.

#### Agent implementation order
- **Step 1.** Define SQL constraints/checks for source data levels, safe IDs, UTC ms integer ranges, JSON objects, checksum shape, positive schema versions, immutable accepted facts and nullable absence semantics.
- **Step 2.** Create a `tv_source_ingestion_owner NOLOGIN` role following 001, grant only necessary SELECT/INSERT to `tv_runtime`, avoid DELETE/DDL and preserve existing grants.
- **Step 3.** Add indexes for provider/epoch/time and quarantined deliveries; use separate receipt identity and event identity rather than a text hash as unique RF key.
- **Step 4.** Add narrow typed SQL readers/writers using `SqlExecutor`, no `pg` in domain/application; preserve existing migration advisory lock/checksum flow.
- **Step 5.** Test migration from baseline 001 in disposable PostgreSQL and repeat migration (`npm run test:postgres:local`); document new schema owner and independent source outbox.

#### Test matrix / executable verification
- Migration against a fresh DB and against a DB that already applied 001; repeated unchanged migrator run is no-op.
- Same scoped delivery key conflict, different source/account allowed, missing receiver columns for provider-only rows, invalid timestamps and malformed JSON fail constraints.
- Runtime cannot alter/delete provenance or migration state; admin can inspect links; real PostgreSQL tests run with restricted runtime grants.
- Check source events are NOT enqueued into a consumer table FK-restricted to correlation events; leave consumer integration to S3-07.

#### Handoff constraints
Use a new migration rather than altering historical SQL. Do not add a generic repository or copy `correlation.outbox` semantics without an explicit cross-owner delivery design.

#### Final evidence checklist for this issue
- Confirm only this scope changed, update the existing acceptance boxes and record the actual branch, PR, merged SHA and migration number (if any).
- Record commands **actually run** and pass/fail/skip results in the issue status log; GitHub Actions not running is **not** a pass.
- Document any source rights/credentials limitation and update `docs/IMPLEMENTATION_STATUS.md` only where implementation status truly changed.
- Close this issue after merge and verified acceptance; check it in #4 and activate the next issue; do not implement the next issue here.


---

## 04. [#8] Implement atomic source-delivery acceptance and scoped idempotency

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/8  
**Phase:** Stage 3 · Source contracts and private ingestion  
**Snapshot status:** DONE · **Dependency:** Issue #7 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Already merged and closed; use as tested contract/reference.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 04 · **Stage:** 3 — Real message connector · **Status:** DONE
> **Depends on:** #7 (DONE, merged and verified). **Do not start until dependency is complete.**

### Message acquisition strategy

Verify that fetching the same page twice, or seeing the same source record on overlapping pages, produces one durable effect. Scope identity and conflicts using the evidence documented in #6.

### Objective and delivered result
Retries of the same provider delivery have one durable effect, and conflicting reuse is rejected.

### Exact implementation steps
1. Validate source-scoped identity, payload checksum, observation time and verified capability before insert.
2. Use `runSqlTransaction` and per-delivery locking/CAS to make a first-write race safe across processes.
3. Return explicit `CREATED`, `DUPLICATE`, `CONFLICTED`, and invalid-data outcomes without overwriting original evidence.
4. Persist the source delivery and an outbox event atomically, without treating an HTTP acknowledgment as completed normalization.
5. Preserve original delivery IDs and provider timing during replay; avoid using an arrival-time-only dedup key.

### Ownership / intended files
`source-connectors/application/accept-source-delivery.ts`; delivery transaction port; PostgreSQL adapter.

### Verification plan
- Concurrent first insertion from two pools/processes; byte-identical retry; content mismatch under an existing scoped key.
- Outbox-insert failure rolls back accepted delivery and is safely retryable.

### Acceptance criteria (check as completed)
- Acceptance is idempotent across restart and concurrent clients.
- No outbox event without committed source delivery.
- The handler returns typed failures and provenance.
- Merged PR linked; passing checks, actual commands/results and limitations recorded below.

### Out of scope
No provider-specific parsing or public API exposed.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Repository baseline and prerequisite inspection
- Start at current `main`; inspect `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/architecture/ARCHITECTURE_V2.md`, the predecessor issue and merged PR. Inspect path names in the repository; paths marked 'proposed' must be created and exported through bounded public entry points.
- Existing implementation touchpoints (read before editing): `packages/backend/src/modules/database-transactions/application/run-sql-transaction.ts`, `demo/infrastructure/postgres/postgres-ingest-transaction.ts`, `modules/event-delivery/infrastructure/fan-out.ts`.
- Target code/docs (new unless already present): `modules/source-connectors/application/accept-source-delivery.ts`, `ports/source-delivery-transaction.ts`, `infrastructure/postgres/...`.
- The existing backend is TypeScript/Node 24 workspaces, with PostgreSQL migrations; there is **no real provider integration or web app yet**. Do not treat proposed paths as pre-existing files.

#### Concrete contract and data shape
Use case `AcceptSourceDelivery(input): Promise<Result<{deliveryId, outcome: CREATED|DUPLICATE}, INVALID|CONFLICT|TRANSIENT>>` accepting only validated canonical metadata. Different facts under same stable provider-scope key must yield CONFLICT, not implicit replacement.

#### Implementation algorithm / sequencing
Acquire per-delivery advisory key or unique INSERT/CAS across independent processes; begin one checked-out PG transaction, read/insert delivery, append outbox in same transaction and return receipt only after commit. Preserve provider observation timestamp on retries and do not mutate accepted canonical digest.

#### Required negative and integration tests
Two-process racing first delivery, crash after COMMIT before HTTP reply, outbox unique key rollback, exact replay vs conflicting replay, no duplicated outbox.

#### Handoff artifact / dependency to next issue
Document event payload and consumer identity for S3-07; do not expose unauthenticated upload endpoints.

#### Agent work protocol and review evidence
1. Confirm predecessor DONE and the currently checked-out branch. Update this issue's **existing status log** to IN PROGRESS, with UTC timestamp, owner, branch, planned touched paths and constraints before writing code.
2. Define types and narrow ports first; implement pure domain validation next, then provider/SQL adapters, application orchestration and composition. Reuse `Result<T,E>`, typed IDs and `runSqlTransaction<T>` where their guarantees match. No generic BaseService or cross-domain private imports.
3. Treat actual observation time, source capability/coverage and publication eligibility as independent facts. Never fake decoded/RF data, a station, a flight session, authorization or remote CI success.
4. Run `npm run check`, real PostgreSQL integration suite when SQL changes, and issue-specific tests listed above. Report **exact commands and pass/fail numbers**. For blocked credentials or real-source permission, change status to BLOCKED with an actionable unblock condition; do not deliver a simulated provider test as a live verification.
5. Open one focused PR referencing this issue; update IN REVIEW, check acceptance boxes only on verified behavior, attach merged SHA, architectural impact, migration/rollback notes and evidence. Mark DONE/close only after merge, then update EPIC #4 counts/checklist and set the next issue READY.

#### Definition of implementation completeness
No TODO-only stubs or fictitious data labeled 'live'. Pure policies have unit tests; external formats have recorded/redacted contract fixtures; persistence uses real PostgreSQL concurrency/rollback tests when applicable. Any unfulfilled criterion remains unchecked and blocks completion.

### Agent implementation blueprint (2026-11-19)

> **Repo grounding:** compared with `main` at commit `373a2755`. Paths listed as **create** are proposed, not existing. The issue body above remains the authoritative objective and acceptance checklist. **Work only on this issue when its predecessor is DONE.**

#### Existing code to inspect before editing
- `packages/backend/src/modules/database-transactions/application/run-sql-transaction.ts`
- `packages/backend/src/demo/infrastructure/postgres/postgres-ingest-transaction.ts`
- `packages/backend/src/modules/aircraft-correlation/infrastructure/postgres/lock-message.ts`
- `db/migrations/002_source_delivery.sql (created in #7)`

#### Proposed file-by-file ownership (create only what is needed)
- `packages/backend/src/modules/source-connectors/application/accept-source-delivery.ts`
- `packages/backend/src/modules/source-connectors/ports/accept-source-delivery-transaction.ts`
- `packages/backend/src/modules/source-connectors/infrastructure/postgres/{lock-source-delivery.ts,postgres-accept-source-delivery.ts}`
- `packages/backend/tests/integration/accept-source-delivery.test.mjs`

#### Concrete contracts and invariants
1. Implement `accept(delivery): Promise<Result<{status:'CREATED'|'DUPLICATE';deliveryId:string}, {code:'CONFLICT'|'INVALID'|'UNAVAILABLE'}>>` with errors explicit; do not retry a conflicting reused stable ID.
2. The source-scoped uniqueness key is `(provider_id,account_scope,source_epoch,external_id)` as declared in #7. For a new key insert immutable delivery and **source outbox event** atomically; for a repeat compare canonical payload hash+schema/source facts before returning DUPLICATE.
3. In a failed commit where the client cannot know the outcome, replay the *same* scoped key and canonical facts. Do not use wall-clock arrival time as the logical dedup identity.

#### Agent implementation order
- **Step 1.** Accept only a fully validated #5 observation and source id/version from the chosen source contract; if an SDK returns raw bytes, hash the exact accepted canonical bytes under a versioned normalization rule.
- **Step 2.** Start one `runSqlTransaction(pool, async sql => ...)` transaction, acquire an advisory lock scoped by the provider key, then check existing row under READ COMMITTED. The lock handles first insert (there is no row to `FOR UPDATE`).
- **Step 3.** On absence, write immutable delivery+provenance and the source-owned outbox event in the same transaction. Do not call `EventEmitter` or send a network notification before commit.
- **Step 4.** On presence, compare all canonical immutable facts; return DUPLICATE only on exact equivalence, otherwise report CONFLICT with safe diagnostics and no update.
- **Step 5.** Ensure every I/O capability expires after transaction completion; use the existing SQL transaction guard and do not leak a raw pool into application code.

#### Test matrix / executable verification
- Two independent pools/procs concurrently accept the same key: exactly one row/event, one CREATED, remaining DUPLICATE.
- Same ID/different payload returns CONFLICT without altering provenance; different provider epochs and stations do not falsely deduplicate.
- Force source outbox constraint failure and verify neither delivery nor outbox event commits; replay after failure succeeds.
- `npm run check` and `npm run test:postgres:local` including restart durability.

#### Handoff constraints
This task is about source delivery acceptance, not decoding or routing to Stage2 correlation. S3-07 implements the consumption bridge between independently owned outboxes.

#### Final evidence checklist for this issue
- Confirm only this scope changed, update the existing acceptance boxes and record the actual branch, PR, merged SHA and migration number (if any).
- Record commands **actually run** and pass/fail/skip results in the issue status log; GitHub Actions not running is **not** a pass.
- Document any source rights/credentials limitation and update `docs/IMPLEMENTATION_STATUS.md` only where implementation status truly changed.
- Close this issue after merge and verified acceptance; check it in #4 and activate the next issue; do not implement the next issue here.


---

## 05. [#9] Implement the selected provider transport with bounded resource budgets

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/9  
**Phase:** Stage 3 · Source contracts and private ingestion  
**Snapshot status:** EXTERNAL GATE / BLOCKED · **Dependency:** Issue #8 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Engineering artifact may be merged, but leave issue open until all external original acceptance criteria are proven.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 05 · **Stage:** 3 — Real message connector · **Status:** BLOCKED
> **Depends on:** #8 (DONE, merged and verified). **Do not start until dependency is complete.**

### Message acquisition strategy

Preserve the working #55 on-demand lookup: npm run messages -- crawl ICAO24 must still read the actual rendered Airframes view for a deliberately selected aircraft, return observed records in memory/stdout, and retain no real content in the database. Use an injected fixture reader or a separate explicit fixture option for offline verification. Replacing the user-facing crawl command with synthetic output is a regression.

Implement two acquisition strategies behind the existing transport boundary. The crawler fetches the approved page scope with bounded pagination, rate, response size and retries. The provider API is a disabled placeholder. Selecting it returns an explicit unavailable result, makes zero network requests and requires no credentials. Verify both paths with offline tests.

Target the rendered [Airframes Live Messages](https://app.airframes.io/messages/live) view within the scope approved by #6. The initial HTML is an application shell. Verify anonymous filter behavior and bound the live observation window. Do not assume numbered pages.

A fresh anonymous browser load confirmed the app uses its own first-party HTTP bootstrap and first-party WebSocket to render the live list. The page rendered seven cards. Preserve normal page-initiated traffic under resource budgets, without implementing a direct provider API client or inspecting credentials. An origin policy that admits only the app hostname or disables every live socket breaks this acceptance path. Keep analytics excluded.

### Objective and delivered result
The first licensed provider can be connected, stopped, resumed and rate-limited without bypassing the generic source boundary.

### Exact implementation steps
1. Implement the page crawler selected in #6 and register the disabled API adapter.
2. If the selected page requires authorized credentials, obtain them from the environment/secret provider; prohibit logging bearer tokens and raw payloads.
3. Bound concurrent requests, message size, poll rate, reconnect backoff/jitter, and pending queue length; obey provider Retry-After and documented quotas.
4. Expose lifecycle `start/stop/health` and delivery callback without parsing domain messages in the transport.
5. On disconnect or shutdown, preserve durable acceptance semantics and never assume data completeness from a healthy connection.

### Ownership / intended files
`packages/backend/src/modules/source-connectors/infrastructure/<provider>/transport`; source connection composition.

### Verification plan
- Selecting the API placeholder reports unavailable and performs zero network requests.
- Fake provider tests for reconnect, 429, unavailable service, malformed transport envelope, shutdown and queue overflow.
- No live account or network access is required for deterministic tests.

### Acceptance criteria (check as completed)
- Transport can be started and cleanly stopped against an approved test endpoint.
- Rate-limit/backpressure behavior is deterministic and documented.
- Adapter exposes provider-specific health without changing domain rules.
- Merged PR linked; passing checks, actual commands/results and limitations recorded below.

### Out of scope
Do not expose fetched contents publicly or change flight correlation policy.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Repository baseline and prerequisite inspection
- Start at current `main`; inspect `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/architecture/ARCHITECTURE_V2.md`, the predecessor issue and merged PR. Inspect path names in the repository; paths marked 'proposed' must be created and exported through bounded public entry points.
- Existing implementation touchpoints (read before editing): `packages/backend/src/demo/infrastructure/delivery-worker.ts`, `modules/event-delivery/ports/delivery-queue.ts`, selected source ADR #6.
- Target code/docs (new unless already present): `modules/source-connectors/infrastructure/<selected-source>/{client,connection,rate-budget,reconnect}.ts`; composition only from entrypoint.
- The existing backend is TypeScript/Node 24 workspaces, with PostgreSQL migrations; there is **no real provider integration or web app yet**. Do not treat proposed paths as pre-existing files.

#### Concrete contract and data shape
`SourceTransport` has `start(onDelivery)`, `stop()`, `health()`, with bounded queue/backpressure and cancellation; `onDelivery` acknowledges only durable acceptance from S3-04. Provider-specific wiring stays private.

#### Implementation algorithm / sequencing
Use documented poll/stream transport; enforce retry-after/rate cap, max packet size and jittered bounded reconnect; refuse unrestricted global polling. For errors classify 4xx permanent vs 429/5xx transient; mark coverage/health independent. Keep provider secrets out of logs and test artifacts.

#### Required negative and integration tests
Fake transport 429 and Retry-After, reconnect storms, malformed transport event, shutdown while delivery pending, bounded memory and request budget; no network in CI.

#### Handoff artifact / dependency to next issue
Expose observability and callbacks for #10/#12, and a command to run a private dry-run with explicit page scope.

#### Agent work protocol and review evidence
1. Confirm predecessor DONE and the currently checked-out branch. Update this issue's **existing status log** to IN PROGRESS, with UTC timestamp, owner, branch, planned touched paths and constraints before writing code.
2. Define types and narrow ports first; implement pure domain validation next, then provider/SQL adapters, application orchestration and composition. Reuse `Result<T,E>`, typed IDs and `runSqlTransaction<T>` where their guarantees match. No generic BaseService or cross-domain private imports.
3. Treat actual observation time, source capability/coverage and publication eligibility as independent facts. Never fake decoded/RF data, a station, a flight session, authorization or remote CI success.
4. Run `npm run check`, real PostgreSQL integration suite when SQL changes, and issue-specific tests listed above. Report **exact commands and pass/fail numbers**. For blocked credentials or real-source permission, change status to BLOCKED with an actionable unblock condition; do not deliver a simulated provider test as a live verification.
5. Open one focused PR referencing this issue; update IN REVIEW, check acceptance boxes only on verified behavior, attach merged SHA, architectural impact, migration/rollback notes and evidence. Mark DONE/close only after merge, then update EPIC #4 counts/checklist and set the next issue READY.

#### Definition of implementation completeness
No TODO-only stubs or fictitious data labeled 'live'. Pure policies have unit tests; external formats have recorded/redacted contract fixtures; persistence uses real PostgreSQL concurrency/rollback tests when applicable. Any unfulfilled criterion remains unchecked and blocks completion.

### Agent implementation blueprint (2026-11-19)

> **Repo grounding:** compared with `main` at commit `373a2755`. Paths listed as **create** are proposed, not existing. The issue body above remains the authoritative objective and acceptance checklist. **Work only on this issue when its predecessor is DONE.**

#### Existing code to inspect before editing
- `packages/backend/src/demo/infrastructure/delivery-worker.ts`
- `packages/backend/src/demo/composition/create-postgres-demo-tracker.ts`
- `apps/api/src/runtime/create-api-runtime.ts`
- `apps/api/src/runtime/storage-config.ts`

#### Proposed file-by-file ownership (create only what is needed)
- `packages/backend/src/modules/source-connectors/infrastructure/<chosen-provider>/{create-transport.ts,parse-envelope.ts,provider-budget.ts,reconnect.ts}`
- `packages/backend/src/modules/source-connectors/composition/create-provider-connector.ts`
- `packages/backend/tests/<provider>-transport.test.mjs`
- `docs/SOURCES.md provider operations section`

#### Concrete contracts and invariants
1. The transport should produce a `SourceDeliveryEnvelope` containing bytes or validated raw JSON plus exact provider metadata, not a domain `MessageView`. It calls the #8 acceptance port; success means **durable acceptance**, not decoded/publication complete.
2. Provide `start(signal): Promise<void>`, `stop(): Promise<void>`, `health(): ProviderConnectionHealth` with explicit `DISCONNECTED`, `DEGRADED`, `HEALTHY` states and `lastReceivedAt`; feed sampling/coverage is a separate descriptor.
3. Provider rate policy must bound in-flight requests, reconnect attempt frequency, 429/Retry-After handling, queued bytes and max envelope size.

#### Agent implementation order
- **Step 1.** Use the exact transport approved in #6. If websocket, define ping/timeout/reconnect; if HTTP poll, implement cursor/ETag and window budget. Do not build both without need.
- **Step 2.** Read credentials from environment through a narrow config parser; never print URL query tokens, payloads or Authorization headers. Default connector disabled until configured.
- **Step 3.** Implement a bounded asynchronous loop with AbortSignal, full-jitter exponential backoff and graceful resource disposal; do not let callback rejections escape process event handlers.
- **Step 4.** If provider reports sampling, preserve it as feed capability; connectedness does not establish complete aircraft reception.
- **Step 5.** Keep network adapter inside infrastructure; register it in a composition root only after #8 transaction is ready, with private mode.

#### Test matrix / executable verification
- Fake provider sends malformed envelope, oversized message, 429 with Retry-After, 500, late response, websocket disconnect and reconnect.
- Cancel start/stop twice: no dangling timer/socket; verify max concurrent messages/bytes under burst.
- No real network or secrets needed for CI; separately record a lawful manual smoke against provider test channel.

#### Handoff constraints
The source choice is not hardcoded here; implement only the selected provider. Do not expose real radio message text through existing public demo routes.

#### Final evidence checklist for this issue
- Confirm only this scope changed, update the existing acceptance boxes and record the actual branch, PR, merged SHA and migration number (if any).
- Record commands **actually run** and pass/fail/skip results in the issue status log; GitHub Actions not running is **not** a pass.
- Document any source rights/credentials limitation and update `docs/IMPLEMENTATION_STATUS.md` only where implementation status truly changed.
- Close this issue after merge and verified acceptance; check it in #4 and activate the next issue; do not implement the next issue here.


---

## 06. [#10] Normalize provider payloads and preserve actual observation granularity

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/10  
**Phase:** Stage 3 · Source contracts and private ingestion  
**Snapshot status:** EXTERNAL GATE / BLOCKED · **Dependency:** Issue #9 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Engineering artifact may be merged, but leave issue open until all external original acceptance criteria are proven.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 06 · **Stage:** 3 — Real message connector · **Status:** BLOCKED
> **Depends on:** #9 (DONE, merged and verified). **Do not start until dependency is complete.**

### Message acquisition strategy

Parse the message records actually displayed on a permitted page fixture. Map only fields evidenced by the page. Test absent optional fields, an empty results page and an incompatible layout. A layout change must be distinguishable from a successful empty result.

Preserve registration, callsign, reception timestamp, direction and feeder only when the rendered record supplies them. A filter match alone does not establish identity, direction or complete receiver coverage.

### Objective and delivered result
Provider deliveries become validated canonical observations while retaining source-specific evidence.

### Exact implementation steps
1. Validate provider schema with versioned decoder and reject/quarantine incompatible payloads instead of casting `any`.
2. Map provider IDs, received/observed timestamps, bearer, direction, decoder version and source description to the S3-01 contract.
3. Implement explicit paths for complete decoded message vs real frame/reception; never synthesize RF frames or station IDs.
4. Normalize aircraft identifier hints into validated ICAO24/registration/callsign fields; do not infer a confirmed flight from a callsign.
5. Preserve and test timestamp uncertainty and protocol stack (e.g. VDL2 transport is not always ACARS content).

### Ownership / intended files
`source-connectors/infrastructure/<provider>/parser` and `communications` normalization adapters.

### Verification plan
- Redacted golden fixtures of valid and invalid real-shape payloads; schema drift, missing time, unknown protocol, repeated text and direction tests.
- Serialization roundtrip tests demonstrating immutable provenance.

### Acceptance criteria (check as completed)
- Canonical result includes correct provenance and declared data level.
- Unknown/invalid provider variants fail explicitly without dropped silent records.
- All fixtures are anonymized and permitted for repository use.
- Merged PR linked; passing checks, actual commands/results and limitations recorded below.

### Out of scope
No delivery scheduler, public content release or station-network UI.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Repository baseline and prerequisite inspection
- Start at current `main`; inspect `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/architecture/ARCHITECTURE_V2.md`, the predecessor issue and merged PR. Inspect path names in the repository; paths marked 'proposed' must be created and exported through bounded public entry points.
- Existing implementation touchpoints (read before editing): `demo/application/parse-message-input.ts`, `demo/domain/canonical-message.ts`, `modules/aircraft-correlation/domain/icao24.ts`, S3 contract #5.
- Target code/docs (new unless already present): `modules/source-connectors/infrastructure/<provider>/decode-wire.ts` and `communications/application/normalize-provider-observation.ts`.
- The existing backend is TypeScript/Node 24 workspaces, with PostgreSQL migrations; there is **no real provider integration or web app yet**. Do not treat proposed paths as pre-existing files.

#### Concrete contract and data shape
Versioned `normalize(rawEnvelope): Result<CanonicalObservation, ParseError>` with source provenance, bearer vs protocol stack, direction, `observedAt` basis, optional ICAO24/registration/callsign, and actual dataLevel. Do not coerce missing values to current time.

#### Implementation algorithm / sequencing
Validate known JSON schema strictly; parse units/time once, distinguish uplink addressee from originating aircraft, preserve unknown protocol classification, decode text safely when rights allow. If only provider-decoded message exists, do not create RF reception or frame rows.

#### Required negative and integration tests
Golden fixtures: message-only, actual-reception, timestamp skew, unknown protocol, uplink/downlink role, conflicting hints, same text at separate timestamps, unsupported schema.

#### Handoff artifact / dependency to next issue
Define persisted message-revision contract and provenance refs for #11.

#### Agent work protocol and review evidence
1. Confirm predecessor DONE and the currently checked-out branch. Update this issue's **existing status log** to IN PROGRESS, with UTC timestamp, owner, branch, planned touched paths and constraints before writing code.
2. Define types and narrow ports first; implement pure domain validation next, then provider/SQL adapters, application orchestration and composition. Reuse `Result<T,E>`, typed IDs and `runSqlTransaction<T>` where their guarantees match. No generic BaseService or cross-domain private imports.
3. Treat actual observation time, source capability/coverage and publication eligibility as independent facts. Never fake decoded/RF data, a station, a flight session, authorization or remote CI success.
4. Run `npm run check`, real PostgreSQL integration suite when SQL changes, and issue-specific tests listed above. Report **exact commands and pass/fail numbers**. For blocked credentials or real-source permission, change status to BLOCKED with an actionable unblock condition; do not deliver a simulated provider test as a live verification.
5. Open one focused PR referencing this issue; update IN REVIEW, check acceptance boxes only on verified behavior, attach merged SHA, architectural impact, migration/rollback notes and evidence. Mark DONE/close only after merge, then update EPIC #4 counts/checklist and set the next issue READY.

#### Definition of implementation completeness
No TODO-only stubs or fictitious data labeled 'live'. Pure policies have unit tests; external formats have recorded/redacted contract fixtures; persistence uses real PostgreSQL concurrency/rollback tests when applicable. Any unfulfilled criterion remains unchecked and blocks completion.

### Agent implementation blueprint (2026-11-19)

> **Repository baseline:** `main` commit `373a2755`. Paths under **create** are proposed. Predecessor must be DONE; never start later issues while this one is in progress.

#### Existing code / contracts to inspect
- `packages/backend/src/demo/application/parse-message-input.ts`
- `packages/backend/src/modules/aircraft-correlation/domain/icao24.ts`
- `packages/backend/src/modules/message-availability/domain/bearer.ts`
- `packages/backend/src/demo/domain/canonical-message.ts`

#### Create or extend these ownership units
- `packages/backend/src/modules/source-connectors/infrastructure/<approved-source>/{decode-payload.ts,normalize-time.ts,extract-address-roles.ts}`
- `packages/backend/src/modules/source-connectors/application/normalize-source-observation.ts`
- `packages/backend/tests/source-normalization.test.mjs`
- `packages/backend/tests/fixtures/<approved-source>/{valid,invalid}/*.json (redacted permitted only)`

#### Non-negotiable data and API contracts
1. Build `normalizeSourceObservation(delivery, capability): Result<CanonicalSourceObservation, {code,field,schemaVersion}>`; preserve `originalSourceId`, `deliveryId`, decoder name/version, `dataLevel`, bearer, optional application protocol, direction and participant roles.
2. Use a versioned source envelope parser. Treat an unknown provider JSON version as `UNKNOWN_SCHEMA`, an invalid timestamp as `UNTRUSTED_TIME`, and unknown bearer/application protocol as explicit `UNKNOWN`/unsupported variants where the source contract allows them. Do not cast strings to branded IDs without validation.
3. Time evidence retains distinct `sourceObservedAt`, `receiverReceivedAt`, `providerPublishedAt`, `ingestedAt`, uncertainty and time basis. A complete provider message is *not* evidence of a raw frame; store raw bytes only when actually supplied/licensed.

#### Agent implementation procedure
- **Step 1.** Extract golden fixtures from the rights-approved source shape selected in #6, sanitize identifiers/body to the documented extent, and preserve a fixture source/version README.
- **Step 2.** Implement a strict wire-level validator that rejects missing mandatory source fields and records extra fields in a bounded diagnostics structure when forward compatibility permits them.
- **Step 3.** Add separate pure normalizers for ICAO24, registration, callsign, time, direction, bearer and protocol stack. Do not guess a flight from callsign or confuse aircraft address vs ground station in uplinks.
- **Step 4.** Select a canonical `PROVIDER_MESSAGE` / `RECEPTION` / `FRAME` path from #5. Only real receptions carry receiver IDs/frequency; do not materialize a fake station to satisfy an adapter.
- **Step 5.** Return typed failures with safe summaries and detailed internal reason codes; never print unredacted raw decoded text or provider token on error.

#### Required executable test matrix
- Golden fixture roundtrip: stable normalization, field provenance/source ID retained and arbitrary input order independent.
- Missing/invalid UTC time, clock skew, wrong type/extra content, uplink vs downlink addresses and unknown protocol.
- Two identical-text observations with distinct source delivery/transmission IDs remain independent canonical events.
- Typecheck, boundary checks, decoder contract tests; if no approved real samples, mark issue BLOCKED rather than claiming a real provider implementation.

#### Integration boundary and handoff
Do not replace existing synthetic `/api/v1/demo/messages` behavior. S3-07 integrates these canonical objects with durable consumption; no public publishing is permitted here.

#### Evidence before marking DONE
- Keep original acceptance criteria; check only verified steps, link merged PR, commit SHA and actual test commands/results.
- Update `docs/IMPLEMENTATION_STATUS.md` and relevant migration/readme only if implementation facts changed; distinguish local vs remote CI.
- Update EPIC #4 checkpoint and next issue only **after** merge and verification. English only.


---

## 07. [#11] Connect canonical source observations to the durable message pipeline

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/11  
**Phase:** Stage 3 · Source contracts and private ingestion  
**Snapshot status:** EXTERNAL GATE / BLOCKED · **Dependency:** Issue #10 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Engineering artifact may be merged, but leave issue open until all external original acceptance criteria are proven.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 07 · **Stage:** 3 — Real message connector · **Status:** BLOCKED
> **Depends on:** #10 (engineering merged and locally verified in PR #61; external source-sample acceptance remains open). Engineering continues with synthetic fixtures under the owner-authorized rule in #4; real-source acceptance is not claimed.

### Message acquisition strategy

Connect records parsed from crawled pages to the durable pipeline. Carry the original delivery identity and page provenance through processing. The disabled provider API has no role in this acceptance path.

### Objective and delivered result
A private permitted provider message completes delivery → normalization → persisted facts → correlation → availability using Stage2 reliability.

### Exact implementation steps
1. Consume accepted source-delivery outbox events through a consumer-specific inbox, with a stable transformation identity.
2. Write provider-message facts and message revisions transactionally; link them to original delivery/provenance, not an invented RF occurrence.
3. Map provider identifiers to current correlation input; preserve UNMATCHED and CONFLICTED outcomes and revision evidence.
4. Emit a correlation/publication-eligible private event without modifying the external demo POST contract or forcing disclosure.
5. Ensure retries, restart and multiple deliveries of the same fact do not duplicate message effects; keep distinct real transmissions distinct.

### Ownership / intended files
`communications/application/import-provider-message.ts`, source consumer, orchestration and adapters.

### Verification plan
- Integration flow on real PostgreSQL from fixture delivery to private status and correlation.
- Failure after commit before ACK, duplicate delivery, same text at different transmission times and unknown aircraft cases.

### Acceptance criteria (check as completed)
- One approved provider payload flows through the durable backend end to end.
- Source lineage is inspectable for every message and status.
- Synthetic demo endpoints remain backward compatible.
- Merged PR linked; passing checks, actual commands/results and limitations recorded below.

### Out of scope
No public broadcast of source messages; access policy still governs visibility.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Repository baseline and prerequisite inspection
- Start at current `main`; inspect `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/architecture/ARCHITECTURE_V2.md`, the predecessor issue and merged PR. Inspect path names in the repository; paths marked 'proposed' must be created and exported through bounded public entry points.
- Existing implementation touchpoints (read before editing): `demo/application/ingest-durable-message.ts`, `demo/composition/create-postgres-demo-tracker.ts`, `modules/event-delivery/infrastructure/consume-event.ts`, `demo/application/project-decision.ts`.
- Target code/docs (new unless already present): `communications/application/import-provider-message.ts`, source consumer composition and immutable `source_delivery_id` link.
- The existing backend is TypeScript/Node 24 workspaces, with PostgreSQL migrations; there is **no real provider integration or web app yet**. Do not treat proposed paths as pre-existing files.

#### Concrete contract and data shape
Source event→normalized message use case must preserve `messageId`, message revision, source delivery IDs, observedAt and decision revision; returns typed imported/duplicate/unmatched/quarantined result. Keep demo `/api/v1/demo/messages` unchanged.

#### Implementation algorithm / sequencing
Consume source-delivery event via inbox; in one transaction insert immutable message facts/revision and correlation outbox, with stable deterministic dedup identity. Do not merge distinct messages on identical text. Let existing event delivery run independent availability projection. All real messages remain internal until publication policy.

#### Required negative and integration tests
Real PostgreSQL delivery→message→correlation→availability; duplicated source delivery, different transmission same payload, disconnect/retry, invalid ICAO/ambiguous match and crash/restart.

#### Handoff artifact / dependency to next issue
Document event lineage query and any newly required migration for #12 operational replay.

#### Agent work protocol and review evidence
1. Confirm predecessor DONE and the currently checked-out branch. Update this issue's **existing status log** to IN PROGRESS, with UTC timestamp, owner, branch, planned touched paths and constraints before writing code.
2. Define types and narrow ports first; implement pure domain validation next, then provider/SQL adapters, application orchestration and composition. Reuse `Result<T,E>`, typed IDs and `runSqlTransaction<T>` where their guarantees match. No generic BaseService or cross-domain private imports.
3. Treat actual observation time, source capability/coverage and publication eligibility as independent facts. Never fake decoded/RF data, a station, a flight session, authorization or remote CI success.
4. Run `npm run check`, real PostgreSQL integration suite when SQL changes, and issue-specific tests listed above. Report **exact commands and pass/fail numbers**. For blocked credentials or real-source permission, change status to BLOCKED with an actionable unblock condition; do not deliver a simulated provider test as a live verification.
5. Open one focused PR referencing this issue; update IN REVIEW, check acceptance boxes only on verified behavior, attach merged SHA, architectural impact, migration/rollback notes and evidence. Mark DONE/close only after merge, then update EPIC #4 counts/checklist and set the next issue READY.

#### Definition of implementation completeness
No TODO-only stubs or fictitious data labeled 'live'. Pure policies have unit tests; external formats have recorded/redacted contract fixtures; persistence uses real PostgreSQL concurrency/rollback tests when applicable. Any unfulfilled criterion remains unchecked and blocks completion.

### Agent implementation blueprint (2026-11-19)

> **Repository baseline:** `main` commit `373a2755`. Paths under **create** are proposed. Predecessor must be DONE; never start later issues while this one is in progress.

#### Existing code / contracts to inspect
- `packages/backend/src/demo/application/ingest-durable-message.ts`
- `packages/backend/src/demo/application/project-decision.ts`
- `packages/backend/src/demo/infrastructure/delivery-worker.ts`
- `packages/backend/src/modules/event-delivery/infrastructure/postgres-event-delivery.ts`
- `db/migrations/001_durable_correlation.sql`

#### Create or extend these ownership units
- `packages/backend/src/modules/source-connectors/application/import-provider-message.ts`
- `packages/backend/src/modules/source-connectors/ports/provider-message-commit.ts`
- `packages/backend/src/modules/source-connectors/infrastructure/postgres/{postgres-provider-message-commit.ts,source-event-router.ts}`
- `db/migrations/<next>_source_event_delivery_bridge.sql`
- `packages/backend/tests/integration/provider-message-pipeline.test.mjs`

#### Non-negotiable data and API contracts
1. A consumer-specific inbox key `(consumerId,eventId)` must record a digest of canonical immutable source event. A provider message ID is namespaced by provider/account/epoch; do not reuse a messageId across unrelated sources or conflate repeated TEXT with repeated transmission.
2. The existing Stage2 `event_delivery.deliveries.event_id` FK targets `correlation.outbox` specifically. Bridge source-owned outbox to the delivery system through an explicit migration/adapter (e.g. durable canonical event registry with producer provenance), and backfill existing Stage2 event routing without losing rows. Do not INSERT a new event type into `correlation.outbox`: its schema enforces one event type.
3. Acceptance, import/correlation and availability are separate commit boundaries: source delivery+outbox atomic, source consumer inbox+imported facts+new decision/outbox atomic, availability consumer inbox+contribution+ack atomic. Clearly document which HTTP ACK guarantees which commit.

#### Agent implementation procedure
- **Step 1.** Design migration strategy for heterogeneous outbox producers. Inventory the exact Stage2 FK and `fan-out.ts/read-outbox-event.ts/consume-event.ts` dependencies, then provide one stable event envelope and per-owner producer readers or registry.
- **Step 2.** Write source consumer whose input comes from the durable accepted source event. Validate canonical observation and reject unsupported data levels before making a message revision; preserve provider source-delivery references.
- **Step 3.** Use deterministic namespaced logical message IDs and immutable revisions with source/decoder version; idempotent retries must create no second message/outbox. Distinct transmissions retain separate IDs even with identical bodies.
- **Step 4.** Invoke existing correlation via public use case/transaction contracts, not by copying `decideAircraftMatch` into an adapter. Preserve `UNMATCHED`, `AMBIGUOUS`, `CONFLICTED` decisions and candidate completeness error handling.
- **Step 5.** Project status only from permitted **private** source data. Retain the legacy synthetic flow and its tests; prepare future independent publication versioning but do not implement it prematurely.

#### Required executable test matrix
- Run real DB migration from existing Stage2 records and prove previously queued correlation events remain consumable.
- Source delivery→canonical provider message→decision→private availability works after killing and restarting worker; forced error rolls back inbox and derived facts.
- Two concurrent workers receiving same source event do not duplicate facts. A lost ACK/replay is idempotent. Identical text from different transmission events stays distinct.
- `npm run check`, `npm run test:postgres:local` and API smoke. Test that source records cannot be read through unauthenticated existing demo endpoints.

#### Integration boundary and handoff
This is the cross-owner reliability boundary; review schema migration and preserve historical outbox correctness. Do not expose new real-message fields in public REST until Stage5 publication gates.

#### Evidence before marking DONE
- Keep original acceptance criteria; check only verified steps, link merged PR, commit SHA and actual test commands/results.
- Update `docs/IMPLEMENTATION_STATUS.md` and relevant migration/readme only if implementation facts changed; distinguish local vs remote CI.
- Update EPIC #4 checkpoint and next issue only **after** merge and verification. English only.


---

## 08. [#12] Implement bounded source replay, quarantine and operational health

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/12  
**Phase:** Stage 3 · Source contracts and private ingestion  
**Snapshot status:** DONE · **Dependency:** Issue #11 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Already merged and closed; use as tested contract/reference.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 08 · **Stage:** 3 — Real message connector · **Status:** DONE
> **Depends on:** #11 (engineering merged and locally verified in PR #62 at 752aa27377abeb53f2042504116422f0ac5d86dc; actual approved-provider acceptance remains open). Engineering continues under the owner-authorized rule in #4.

### Message acquisition strategy

Exercise replay across overlapping pages, transient fetch failures and a changed page layout. Record fetch and parse outcomes separately so a broken parser cannot report healthy ingestion of zero messages.

### Objective and delivered result
Source failures can be diagnosed and recovered without unbounded backfill, duplicate processing or exposing payloads.

### Exact implementation steps
1. Provide a bounded backfill window with explicit source checkpoint, rate budget and replay cursor/epoch.
2. Separate transient errors (retry with backoff) from permanent schema/rights errors (durable quarantine).
3. Record source health, ingest lag, source coverage/sampling mode and last valid provider timestamp independently.
4. Create an administrative local-only replay and quarantine inspection command that redacts confidential payloads.
5. Document safe recovery for partial outage, cursor expiry and provider terms changes; no silent data loss.

### Ownership / intended files
Source replay runner, retry policy, quarantine reader and health metrics.

### Verification plan
- Replayed overlapping windows, expired cursor, 429, poison payload, partial provider outage and restart scenarios.
- Verify logs and metrics omit credentials and sensitive raw contents.

### Acceptance criteria (check as completed)
- Failures are visible and recoverable with bounded work.
- Replay is idempotent and cannot produce fresh status from old observed time.
- Health explicitly distinguishes sampled coverage from feed failure.
- Merged PR linked; passing checks, actual commands/results and limitations recorded below.

### Out of scope
No user-facing realtime gateway or source completeness percentage assumptions.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Repository baseline and prerequisite inspection
- Start at current `main`; inspect `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/architecture/ARCHITECTURE_V2.md`, the predecessor issue and merged PR. Inspect path names in the repository; paths marked 'proposed' must be created and exported through bounded public entry points.
- Existing implementation touchpoints (read before editing): `modules/event-delivery/infrastructure/{retry-delivery,recover-expired,quarantine-delivery}.ts`, `demo/infrastructure/delivery-worker.ts`, `docs/POSTGRES.md`.
- Target code/docs (new unless already present): `source-connectors/application/{replay-window,quarantine-review,source-health}.ts`, bounded admin CLI.
- The existing backend is TypeScript/Node 24 workspaces, with PostgreSQL migrations; there is **no real provider integration or web app yet**. Do not treat proposed paths as pre-existing files.

#### Concrete contract and data shape
Replay requests: sourceID + start/end + maxDeliveries + checkpoint; result records applied/duplicate/quarantined counts. Health states independent of coverage and message freshness.

#### Implementation algorithm / sequencing
Persist source progress after durable receipt, replay bounded time ranges with provider-specific rate budgets, preserve `observedAt`, use retry backoff for transient and quarantine for permanent/schema/rights failures. Redact payload from error logs and admin output.

#### Required negative and integration tests
Cursor expiry, repeated bounded backfill, incomplete time basis, poisoned payload, 429, source health vs zero RF traffic, lost ACK and crash.

#### Handoff artifact / dependency to next issue
Provide private provider smoke/runbook and metrics for #13.

#### Agent work protocol and review evidence
1. Confirm predecessor DONE and the currently checked-out branch. Update this issue's **existing status log** to IN PROGRESS, with UTC timestamp, owner, branch, planned touched paths and constraints before writing code.
2. Define types and narrow ports first; implement pure domain validation next, then provider/SQL adapters, application orchestration and composition. Reuse `Result<T,E>`, typed IDs and `runSqlTransaction<T>` where their guarantees match. No generic BaseService or cross-domain private imports.
3. Treat actual observation time, source capability/coverage and publication eligibility as independent facts. Never fake decoded/RF data, a station, a flight session, authorization or remote CI success.
4. Run `npm run check`, real PostgreSQL integration suite when SQL changes, and issue-specific tests listed above. Report **exact commands and pass/fail numbers**. For blocked credentials or real-source permission, change status to BLOCKED with an actionable unblock condition; do not deliver a simulated provider test as a live verification.
5. Open one focused PR referencing this issue; update IN REVIEW, check acceptance boxes only on verified behavior, attach merged SHA, architectural impact, migration/rollback notes and evidence. Mark DONE/close only after merge, then update EPIC #4 counts/checklist and set the next issue READY.

#### Definition of implementation completeness
No TODO-only stubs or fictitious data labeled 'live'. Pure policies have unit tests; external formats have recorded/redacted contract fixtures; persistence uses real PostgreSQL concurrency/rollback tests when applicable. Any unfulfilled criterion remains unchecked and blocks completion.

### Agent implementation blueprint (2026-11-19)

> **Repository baseline:** `main` commit `373a2755`. Paths under **create** are proposed. Predecessor must be DONE; never start later issues while this one is in progress.

#### Existing code / contracts to inspect
- `packages/backend/src/modules/event-delivery/infrastructure/{retry-delivery.ts,recover-expired.ts,quarantine-delivery.ts}`
- `packages/backend/src/demo/infrastructure/delivery-worker.ts`
- `scripts/postgres/run-integration.mjs`

#### Create or extend these ownership units
- `packages/backend/src/modules/source-connectors/application/{replay-source-range.ts,plan-source-retry.ts,quarantine-source-delivery.ts}`
- `packages/backend/src/modules/source-connectors/ports/source-replay-checkpoint.ts`
- `packages/backend/src/modules/source-connectors/infrastructure/postgres/{source-replay-store.ts,source-health-reader.ts}`
- `scripts/source/{replay.mjs,inspect-quarantine.mjs}`
- `docs/SOURCE_OPERATIONS.md`

#### Non-negotiable data and API contracts
1. A replay request is `(provider,account,sourceEpoch,from,to,limit,mode)` with a bounded interval, provider request budget and resumable cursor; no unbounded `replay everything` switch.
2. Retry and poison-state outcome variants distinguish `RETRY_AFTER`, `TRANSIENT_FAILURE`, `MALFORMED_PAYLOAD`, `UNAUTHORIZED`, `QUOTA_EXHAUSTED` and `RIGHTS_REVOKED`. Permanent failures remain durable in quarantine with redacted error metadata.
3. Health projection returns `(connectionState,lastConnectionAt,lastProviderEventAt,ingestLag,coverageKind,asOf)`; `SAMPLED` coverage and a `HEALTHY` connection may coexist; neither means all aircraft were heard.

#### Agent implementation procedure
- **Step 1.** Implement pure backoff/retry planning with provider-specific maximum duration and allowed status codes; add jitter only in scheduling adapter.
- **Step 2.** Persist source cursor/replay range, attempt ID, last error code and quarantine state transactionally. Reuse Stage2 fenced leases/consumer inbox where applicable.
- **Step 3.** On source disconnect or quota exhaustion stop retry storms; surface explicit health. A rights revocation must disable ingestion and trigger policy review, never silently retry prohibited access.
- **Step 4.** Create an operator-only script that prints counts, source/checkpoint, error codes and safe IDs, not raw payloads or credentials.
- **Step 5.** Test bounded overlapping replay and crash recovery, and write a runbook with provider terms, manual resume and safe rollback.

#### Required executable test matrix
- Quarantine poison delivery then replay only after issue is resolved; idempotency intact.
- Malformed payload, 429 Retry-After, disconnect mid-window, expired cursor, clock skew and restart; validate maximum in-flight requests/bytes.
- Old observedAt remains old after backfill; source coverage and health statuses remain independent.
- Real PostgreSQL integration suite; test administrative script rejects unscoped/remote cleanup inputs.

#### Integration boundary and handoff
Do not mark Stage3 complete here; #13 performs the actual approved live-data E2E gate. Source access/rights may still block provider test.

#### Evidence before marking DONE
- Keep original acceptance criteria; check only verified steps, link merged PR, commit SHA and actual test commands/results.
- Update `docs/IMPLEMENTATION_STATUS.md` and relevant migration/readme only if implementation facts changed; distinguish local vs remote CI.
- Update EPIC #4 checkpoint and next issue only **after** merge and verification. English only.


---

## 09. [#13] Verify one authorized live-source end-to-end private integration

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/13  
**Phase:** Stage 3 · Source contracts and private ingestion  
**Snapshot status:** EXTERNAL GATE / BLOCKED · **Dependency:** Issue #12 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Engineering artifact may be merged, but leave issue open until all external original acceptance criteria are proven.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 09 · **Stage:** 3 — Real message connector · **Status:** BLOCKED
> **Depends on:** #12 (DONE, merged and verified). **Do not start until dependency is complete.**

### Message acquisition strategy

Verify one actual permitted message from the selected page through crawl, parse, storage and the private read API. Record the source page, retrieval window and resulting delivery evidence. The deferred provider API has no live acceptance requirement.

### Objective and delivered result
Stage3 closes only after actual permitted source data reaches the private database and a matching/unmatched result is observable.

### Exact implementation steps
1. Run the chosen connector with documented website crawl and retention permissions and a redacted sample; record source kind and tested time window.
2. Trace at least one incoming observation through delivery, normalization, immutable message, correlation, availability and read API.
3. Verify negative cases: reconnect duplicate, failed decode, timestamp quality, unresolved aircraft and source disconnection.
4. Record verified provider limitations and observed end-to-end latency (do not promise production capacity).
5. Publish an English runbook and mark Stage3 implemented only for the verified private data level/source.

### Ownership / intended files
`tests/e2e/source-integration`, runbook and `docs/IMPLEMENTATION_STATUS.md`.

### Verification plan
- Pass real PostgreSQL integration tests and a manual/automated provider smoke against authorized data.
- Provide redacted evidence and a linked PR; do not commit secret headers, exact private payloads or prohibited data.

### Acceptance criteria (check as completed)
- One actual licensed message arrives with verifiable lineage.
- Private/read-only usage conditions remain enforced.
- Source health and availability remain separate.
- Merged PR linked; passing checks, actual commands/results and limitations recorded below.

### Out of scope
Not a public launch and not proof of global message coverage.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Repository baseline and prerequisite inspection
- Start at current `main`; inspect `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/architecture/ARCHITECTURE_V2.md`, the predecessor issue and merged PR. Inspect path names in the repository; paths marked 'proposed' must be created and exported through bounded public entry points.
- Existing implementation touchpoints (read before editing): `docs/IMPLEMENTATION_STATUS.md`, `docs/API.md`, `docs/ROADMAP.md`, all #5–#12 PRs.
- Target code/docs (new unless already present): `tests/e2e/source-connector` (private smoke harness) and `docs/SOURCE_VALIDATION.md`.
- The existing backend is TypeScript/Node 24 workspaces, with PostgreSQL migrations; there is **no real provider integration or web app yet**. Do not treat proposed paths as pre-existing files.

#### Concrete contract and data shape
Acceptance evidence must contain source/date/data-level, redacted delivery ID, provider rights decision, persisted provenance ref, correlation result, availability state, and observed/ingested timestamps.

#### Implementation algorithm / sequencing
Run permitted connector against authorized source, follow one trace through transport, delivery, parser, correlation and projection. Exercise a replay and a deliberately unmatched message; verify no public endpoint exposes restricted raw payload.

#### Required negative and integration tests
Attach redacted output from actual source and real PG + all local checks; log actual CI run separately. No source permission → BLOCKED.

#### Handoff artifact / dependency to next issue
Stage4 may rely on validated message feed, not on complete global coverage.

#### Agent work protocol and review evidence
1. Confirm predecessor DONE and the currently checked-out branch. Update this issue's **existing status log** to IN PROGRESS, with UTC timestamp, owner, branch, planned touched paths and constraints before writing code.
2. Define types and narrow ports first; implement pure domain validation next, then provider/SQL adapters, application orchestration and composition. Reuse `Result<T,E>`, typed IDs and `runSqlTransaction<T>` where their guarantees match. No generic BaseService or cross-domain private imports.
3. Treat actual observation time, source capability/coverage and publication eligibility as independent facts. Never fake decoded/RF data, a station, a flight session, authorization or remote CI success.
4. Run `npm run check`, real PostgreSQL integration suite when SQL changes, and issue-specific tests listed above. Report **exact commands and pass/fail numbers**. For blocked credentials or real-source permission, change status to BLOCKED with an actionable unblock condition; do not deliver a simulated provider test as a live verification.
5. Open one focused PR referencing this issue; update IN REVIEW, check acceptance boxes only on verified behavior, attach merged SHA, architectural impact, migration/rollback notes and evidence. Mark DONE/close only after merge, then update EPIC #4 counts/checklist and set the next issue READY.

#### Definition of implementation completeness
No TODO-only stubs or fictitious data labeled 'live'. Pure policies have unit tests; external formats have recorded/redacted contract fixtures; persistence uses real PostgreSQL concurrency/rollback tests when applicable. Any unfulfilled criterion remains unchecked and blocks completion.

### Agent implementation blueprint (2026-11-19)

> **Repository baseline:** `main` commit `373a2755`. Paths under **create** are proposed. Predecessor must be DONE; never start later issues while this one is in progress.

#### Existing code / contracts to inspect
- `docs/ROADMAP.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `docs/API.md`
- `docs/POSTGRES.md`
- `scripts/postgres/run-integration.mjs`
- `packages/backend/src/demo/composition/create-postgres-demo-tracker.ts`

#### Create or extend these ownership units
- `packages/backend/tests/integration/provider-live-smoke.test.mjs (if lawful deterministic recorded source fixture)`
- `scripts/source/smoke-authorized.mjs (optional manual approved connection)`
- `docs/SOURCE_INTEGRATION_RUNBOOK.md`
- `docs/IMPLEMENTATION_STATUS.md Stage3 section`

#### Non-negotiable data and API contracts
1. The E2E evidence chain must contain an actual `sourceDeliveryId → provider observationId → logical message revision → aircraft link decision revision → visibility-scoped availability contribution → read DTO` plus real source/provider and timestamp level.
2. Document measured source lag, publication rights and whether a source returns only decoded provider messages, RF frames, or station receptions. If a real message cannot be legally inspected or stored, **do not mark Stage3 DONE**.
3. `MATCHED` and `UNMATCHED` are valid domain outcomes; a successful provider transport with no valid correlation is not a completed source-to-map proof unless the specified result and evidence can be inspected. Never claim a global receiver coverage percentage.

#### Agent implementation procedure
- **Step 1.** Run the approved provider connector using an authorized account/environment under private loopback conditions; record provider endpoint, date and permissions without disclosing secrets.
- **Step 2.** Trace one legally obtained observation through intake, commit, replay, decoder, correlation and status read; save redacted IDs, event and decision versions and processing time intervals.
- **Step 3.** Exercise a second replay of the same delivery, a failed decoder message, an unknown aircraft, and a source disconnect. Verify no duplicate effect or false fresh status.
- **Step 4.** Confirm the existing demo HTTP API remains synthetic and real content is not available to anonymous clients. Keep source-derived publication disabled until Stage5.
- **Step 5.** Update implementation-status and roadmap with evidence-based Stage3 status. Link exact tests/PRs, known limitations, and manual access prereqs.

#### Required executable test matrix
- `npm run check` + `npm run test:postgres:local`; complete one approved provider smoke with documented source/data shape.
- Restart worker and API between source acceptance and consumer projection, then confirm replay and event lineage.
- Validate secrets/raw sensitive content are absent from logs, fixtures, GitHub artifacts and publicly reachable endpoints.

#### Integration boundary and handoff
Stage4 may begin only after a genuine authorized source flow is verified. If access/rights not available, status BLOCKED and the epic must not skip ahead to Stage4.

#### Evidence before marking DONE
- Keep original acceptance criteria; check only verified steps, link merged PR, commit SHA and actual test commands/results.
- Update `docs/IMPLEMENTATION_STATUS.md` and relevant migration/readme only if implementation facts changed; distinguish local vs remote CI.
- Update EPIC #4 checkpoint and next issue only **after** merge and verification. English only.


---

## 10. [#14] Define validated position observations and adapter contracts

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/14  
**Phase:** Stage 4 · Flight positions and map  
**Snapshot status:** DONE · **Dependency:** Issue #13 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Already merged and closed; use as tested contract/reference.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 10 · **Stage 4 — Positions & private map MVP** · **Status:** DONE
> **Depends on:** #13 engineering merged and locally verified in PR #64 at `90d33b30d23e2f73970051b4bc57c166d742cea3`; actual licensed-source acceptance remains externally blocked. Provider-neutral position engineering proceeds under the owner decision in epic #4.

### Objective / deliverable
ADS-B/MLAT position facts are typed independently of communications and describe their actual measurement source and quality.

### Implementation instructions
1. Define `PositionObservation` with ICAO24 or confirmed stable identifier, lat/lon, position observed time, ingest time, source ID, measurement kind (`ADS_B`, `MLAT`, etc.), and timestamp uncertainty.
2. Parse units and optional speed/altitude/heading explicitly, distinguishing barometric and geometric altitude and null from zero.
3. Validate geographic ranges, impossible dates, incomplete payloads and source capabilities without manufacturing missing coordinates.
4. Create `PositionAdapter<TRaw>` and a versioned canonical boundary; isolate provider wire shape from domain entities.
5. Define stale position policy separately from communication freshness and document correctness limits.

### Intended code / documentation ownership
`flight-tracking/domain`, `source-connectors/ports`, `docs/POSITIONS.md`.

### Required verification
- Unit/property tests for coordinates, units, missing data, future/out-of-order timestamps and measurement distinctions.
- Architecture/type checks.

### Acceptance checklist
- Position data cannot accidentally refresh radio-message freshness.
- Provider-independent canonical position contract is documented and tested.
- Missing/invalid measurements produce explicit outcomes.
- Reviewed PR merged; verification commands/results, migration impact and limitations linked in this issue.

### Explicit non-goals
No actual ADS-B connector or PostgreSQL write.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Baseline inspection and implementation ownership
- Read `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md`, direct predecessor issue and its merged PR, plus: `contracts/identity/index.ts`, `kernel/time/epoch-millis.ts`, `modules/message-availability/domain/classify-age.ts`.
- Proposed creation/updates: `modules/flight-tracking/domain/{position-observation,position-quality,latitude,longitude,position-time}.ts`, `ports/position-parser.ts` (new). These paths denote **new modules** unless already present on current main; inspect the tree before writing. The Stage2 backend exists; live positions, PostGIS and `apps/web` are not baseline features.
- Preserve existing TypeScript strict mode, typed identifiers, `Result`, architecture checker and narrow port/adapters. No cross-context deep imports or monolithic controller containing domain rules.

#### Precise data/API contract
`PositionObservation` must carry exact source delivery, `observedAt` and time precision, lat/lon, `measurementKind`, optional ground speed/track and optional barometric/geometric altitudes in distinct units. Parse with `Result` validators. No route or flightId required.

#### Required algorithm and error handling
Reject lat outside [-90,90], lon outside [-180,180], nonfinite numbers, future observations beyond documented tolerance and ambiguous speed units; keep absent alt/speed null rather than zero.

#### Tests and proof
Add unit/property tests on ±90/±180, wraparound, missing optional fields, ADS_B/MLAT, clock uncertainty; no domain import of PG or HTTP.

#### Agent execution steps
1. Confirm immediate predecessor DONE; in the existing issue status log record UTC date, branch, owner, intended changed files and prerequisites. Set IN PROGRESS **before coding**.
2. Add validated public contract + tests first. Add small pure rules separately from use-case orchestration; build adapters, persistence and API/UI last. Update public module exports, test fixtures and architecture gates only where justified.
3. Run `npm run check` and every issue-specific suite. Any SQL change requires real PG integration; any browser interaction requires Playwright. Report actual commands/results, not claimed CI. Verify privacy/data rights before using real feeds.
4. Record schema changes, constraints, concurrency handling, replay/idempotency, error responses, non-goals and how the next issue will consume the resulting interface.
5. Open one focused PR, set IN REVIEW and link it, tick accepted checkboxes only with evidence; after merge record commit and actual tests, set DONE/close, then update #4 and activate exactly the next issue. A blocked provider/permission keeps this issue BLOCKED with an exact action to unblock.

#### Delivery gate
A runnable vertical behavior within this task, unit/contract tests, negative/failure cases and applicable DB/browser checks are mandatory; no fake live data, no empty scaffolding and no public exposure of unlicensed messages.

### Agent implementation blueprint (2026-11-19)

> **Verified baseline:** `main@373a2755` (Stage2). Some paths referenced below exist only after predecessor issues; all **create** paths are proposed. Do not claim a source, contract or SQL table exists until merged.

#### Read existing code / predecessor output
- `packages/backend/src/contracts/identity/aircraft-id.ts`
- `packages/backend/src/kernel/time/epoch-millis.ts`
- `packages/backend/src/demo/domain/fixture-aircraft.ts`
- `packages/backend/src/demo/public/types.ts`

#### Create or extend these files (single responsibility per unit)
- `packages/backend/src/modules/flight-tracking/domain/{position-observation.ts,position-measurement.ts,geo-coordinate.ts,position-quality.ts,position-freshness.ts}`
- `packages/backend/src/modules/flight-tracking/ports/position-adapter.ts`
- `packages/backend/src/modules/flight-tracking/public/index.ts`
- `packages/backend/tests/position-contracts.test.mjs`
- `docs/POSITION_DATA.md`

#### Types, database or API contract to implement
1. Canonical `PositionObservation` MUST include stable `sourceObservationId`, `sourceId`, `observedAt`, `ingestedAt`, `measurement:'ADS_B'|'MLAT'|'OTHER'`, latitude/longitude and `identifierHints` (ICAO24 optional when legitimately missing).
2. Represent `Altitude` as tagged `BAROMETRIC_FT` or `GEOMETRIC_FT`, and speed as explicit knots; avoid mixing feet/meters, ground/air speed, or turning `null` into zero. Heading only when actually observed.
3. Use coordinate bounds lat [-90,90], lon [-180,180], finite numbers, timestamp quality and explicit uncertainty. Keep actual position quality separate from communications freshness `RECENT/STALE/NONE`.

#### Implementation sequence for the agent
- **1.** Inspect fixture Position DTO, but do not reuse `FixtureAircraft` as a real observation. Define immutable observation types and dedicated constructors accepting `unknown` and `Result` errors.
- **2.** Define a `PositionSourceAdapter<Raw>.parse(raw)` port and discriminated validation failures; no framework/network imports in domain.
- **3.** Implement timestamp normalization and measurement conversion in small pure functions; document whether source supplies position time vs fetch time.
- **4.** Add example serialization to a stable versioned DTO for later SQL, including optional measurements without fabricated defaults.
- **5.** Export only domain contracts in public index and verify the new module obeys architecture checker.

#### Mandatory regression scenarios
- Reject NaN, Infinity, lat=91, lon=181, malformed UTC, missing ID when contract requires one and unit mismatch.
- Preserve zero altitude/speed as valid measurement when explicitly provided; distinguish unknown vs zero.
- Example ADS-B vs MLAT and delayed historical observation must roundtrip without changing message availability.

#### Integration boundary
No provider call or DB writing; this task defines how *real* observations differ from synthetic fixture positions. Stage4 source adapter #15 must use these constructors.

#### Merge evidence and status update
- Preserve/complete the issue's original acceptance checklist; link merged PR, actual commands/results, local versus remote CI, and migration/rollback notes.
- Update this issue's status log and EPIC #4 in sequence. Do not activate another issue before merge and acceptance.
- Maintain English docs/comments/UI text and follow `AGENTS.md`; update `docs/IMPLEMENTATION_STATUS.md` as needed.


---

## 11. [#15] Integrate one authorized ADS-B/MLAT source transport and parser

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/15  
**Phase:** Stage 4 · Flight positions and map  
**Snapshot status:** EXTERNAL GATE / BLOCKED · **Dependency:** Issue #14 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Engineering artifact may be merged, but leave issue open until all external original acceptance criteria are proven.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 11 · **Stage 4 — Positions & private map MVP** · **Status:** BLOCKED
> **Blocked by:** #14. Complete and verify the predecessor before starting this issue.

### Objective / deliverable
Live aircraft position observations arrive through a bounded, licensed provider adapter, with explicit source health and sampling properties.

### Implementation instructions
1. Verify the selected ADS-B/MLAT provider's current API access, redistribution conditions, geospatial query budget and key requirements; record the choice in an ADR.
2. Implement bounded polling/stream transport and a versioned parser to S4-01 observations; attach genuine source and measurement metadata.
3. Add retries/backoff, Retry-After handling, structured error categories and shutdown semantics independent of message ingestion.
4. Include fixture-based contract tests; never rely on internet access for CI, or hardcode credentials.
5. Default to a private/loopback preview of live data until Stage5 publication controls are implemented.

### Intended code / documentation ownership
`source-connectors/infrastructure/position/<provider>` and provider contract fixtures.

### Required verification
- Provider-shape fixtures: valid ADS-B, MLAT, missing altitude, stale timestamp and unknown source fields.
- Transport error, 429/rate limit, disconnect/reconnect and cancellation tests.

### Acceptance checklist
- A real permitted position feed yields validated canonical position observations. (Earlier aggregate-only preview is historical; acceptance awaits evidence for the final reviewed code and the private-use decision.)
- Usage limits and non-public scope are documented.
- A deterministic offline contract-test suite passes.
- Reviewed PR merged; verification commands/results, migration impact and limitations linked in this issue.

### Explicit non-goals
No live public map or unverified position accuracy claims.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Baseline inspection and implementation ownership
- Read `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md`, direct predecessor issue and its merged PR, plus: `docs/SOURCES.md`, source adapter from #9, `docs/POSITIONS.md`.
- Proposed creation/updates: `modules/source-connectors/infrastructure/positions/<selected-provider>/{transport,parse-response,request-budget}.ts`. These paths denote **new modules** unless already present on current main; inspect the tree before writing. The Stage2 backend exists; live positions, PostGIS and `apps/web` are not baseline features.
- Preserve existing TypeScript strict mode, typed identifiers, `Result`, architecture checker and narrow port/adapters. No cross-context deep imports or monolithic controller containing domain rules.

#### Precise data/API contract
Source adapter maps provider-specific timestamps/fields to the S4-01 canonical observation; transport has start/stop and documented provider quota. Source access and redistribution approval are a hard external gate.

#### Required algorithm and error handling
Use provider terms evidence, explicit approved bbox/regions and bounded poll interval, respect Retry-After/429 and missing/ambiguous measurements. No automatic persistence in parser.

#### Tests and proof
Fixture-based provider contract tests with disconnected network, stale data, 429, wrong units, MLAT and missing height; private smoke only if rights permit.

#### Agent execution steps
1. Confirm immediate predecessor DONE; in the existing issue status log record UTC date, branch, owner, intended changed files and prerequisites. Set IN PROGRESS **before coding**.
2. Add validated public contract + tests first. Add small pure rules separately from use-case orchestration; build adapters, persistence and API/UI last. Update public module exports, test fixtures and architecture gates only where justified.
3. Run `npm run check` and every issue-specific suite. Any SQL change requires real PG integration; any browser interaction requires Playwright. Report actual commands/results, not claimed CI. Verify privacy/data rights before using real feeds.
4. Record schema changes, constraints, concurrency handling, replay/idempotency, error responses, non-goals and how the next issue will consume the resulting interface.
5. Open one focused PR, set IN REVIEW and link it, tick accepted checkboxes only with evidence; after merge record commit and actual tests, set DONE/close, then update #4 and activate exactly the next issue. A blocked provider/permission keeps this issue BLOCKED with an exact action to unblock.

#### Delivery gate
A runnable vertical behavior within this task, unit/contract tests, negative/failure cases and applicable DB/browser checks are mandatory; no fake live data, no empty scaffolding and no public exposure of unlicensed messages.

### Agent implementation blueprint (2026-11-19)

> **Verified baseline:** `main@373a2755` (Stage2). Some paths referenced below exist only after predecessor issues; all **create** paths are proposed. Do not claim a source, contract or SQL table exists until merged.

#### Read existing code / predecessor output
- `packages/backend/src/modules/source-connectors/public/index.ts (from Stage3)`
- `packages/backend/src/modules/flight-tracking/public/index.ts (from #14)`
- `apps/api/src/runtime/storage-config.ts`
- `docs/SOURCES.md`

#### Create or extend these files (single responsibility per unit)
- `packages/backend/src/modules/source-connectors/infrastructure/positions/<approved-provider>/{fetch-positions.ts,decode-position.ts,position-budget.ts}`
- `packages/backend/tests/positions-provider-contract.test.mjs`
- `docs/adr/0002-position-source.md`
- `docs/POSITION_DATA.md provider section`

#### Types, database or API contract to implement
1. The adapter output is `readonly PositionObservation[]` plus `SourceBatchMetadata {sourceId,fetchedAt,coverage,completeness,requestBudget}`; never return a raw provider response to the domain.
2. Provider rate policy must specify max geographic area/bbox and request volume. A provider returning an aircraft list does not prove it covers all aircraft; missing entries are not negative observations.
3. `SourceHealth` tracks connectivity separately from the per-observation freshness and quality. Preserve MLAT/ADS-B as distinct measurement types and source time uncertainty.

#### Implementation sequence for the agent
- **1.** Choose one actual source based on current API documentation, terms, rate limits, data rights and authenticated access; write exact endpoint/method and review date in ADR.
- **2.** Implement bounded poller or stream with AbortSignal, safe defaults, Retry-After and rate limiter. Obtain API credentials from environment; no hardcoded key.
- **3.** Build versioned parser using #14 pure constructors and source-specific mappings for ICAO24, time, lat/lon, altitude, speed and heading; preserve unknown fields only as bounded diagnostic metadata.
- **4.** Apply provider bbox/window limits and cancel overlapping stale requests. Do not fabricate missing positions/airport routes on source gaps.
- **5.** Wire provider transport through composition root (not domain). Permit live ingest only in private/dev mode; remote CI uses redacted permitted fixtures.

#### Mandatory regression scenarios
- Fixture: valid ADS-B, MLAT, missing altitude/heading, swapped coordinate order, wrong timestamp, invalid ICAO address and unknown data level.
- Transport: 429, 503, timeout, cancellation, backoff and graceful stop with no timers left.
- Manual authorized provider smoke recorded without secrets/public source data dump; `npm run check` must pass.

#### Integration boundary
Do not yet write the position table or show live data in the public UI. Stage4 #16 owns persistence.

#### Merge evidence and status update
- Preserve/complete the issue's original acceptance checklist; link merged PR, actual commands/results, local versus remote CI, and migration/rollback notes.
- Update this issue's status log and EPIC #4 in sequence. Do not activate another issue before merge and acceptance.
- Maintain English docs/comments/UI text and follow `AGENTS.md`; update `docs/IMPLEMENTATION_STATUS.md` as needed.


---

## 12. [#16] Persist append-only position history with spatial indexes

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/16  
**Phase:** Stage 4 · Flight positions and map  
**Snapshot status:** DONE · **Dependency:** Issue #15 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Already merged and closed; use as tested contract/reference.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 12 · **Stage 4 — Positions & private map MVP** · **Status:** DONE
> **Blocked by:** #15. Complete and verify the predecessor before starting this issue.
> **Dependency update:** #15 engineering merged and passed local CI on main in PR #57. Its live-source rights acceptance remains open; #16 proceeds with synthetic position history under the epic coordinator decision, without persisting real provider rows.

### Objective / deliverable
Position observations are durable, deduplicated per genuine source fact, and queryable by aircraft/time/area.

### Implementation instructions
1. Create a `tracking` schema and append-only position table with observed time, received time, measurement quality, source/delivery linkage and immutable event ID.
2. Use validated latitude/longitude types with PostGIS or appropriate indexed geometry; handle longitude bounds, antimeridian and precision.
3. Guarantee duplicate-delivery idempotency without merging independently measured observations from different sources.
4. Add indexes for ICAO24/time and spatial bounding-box access, plus explicitly restricted runtime grants.
5. Write a transaction use case for inserting position facts and emitting a domain outbox record atomically.

### Intended code / documentation ownership
`db/migrations/003_*.sql`, `flight-tracking/ports`, PostgreSQL adapter.

### Required verification
- Real PostgreSQL migration, role and index verification; duplicate/reordered observations and restart tests.
- Concurrent first-write and rollback tests including outbox failure.

### Acceptance checklist
- No positions are silently overwritten or inflated by retries.
- History query by aircraft and time is deterministic and bounded.
- DB integration tests pass.
- Reviewed PR merged; verification commands/results, migration impact and limitations linked in this issue.

### Explicit non-goals
No current-position selection logic or public map endpoint.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Baseline inspection and implementation ownership
- Read `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md`, direct predecessor issue and its merged PR, plus: `db/migrations/001_durable_correlation.sql`, `scripts/postgres/migrate.mjs`, `modules/database-transactions/application/run-sql-transaction.ts`.
- Proposed creation/updates: `db/migrations/003_position_observations.sql`, `modules/flight-tracking/infrastructure/postgres/{append-observation,read-position-history}.ts`. These paths denote **new modules** unless already present on current main; inspect the tree before writing. The Stage2 backend exists; live positions, PostGIS and `apps/web` are not baseline features.
- Preserve existing TypeScript strict mode, typed identifiers, `Result`, architecture checker and narrow port/adapters. No cross-context deep imports or monolithic controller containing domain rules.

#### Precise data/API contract
Propose `tracking.position_observations` with immutable `(source_id,source_observation_id)` uniqueness where valid, recorded/observed time, geometry(Point,4326) or validated lat/lon, method, quality and provenance. Use map spatial index and `(aircraft/icao24,observed_at,id)` time index.

#### Required algorithm and error handling
Do not overwrite older facts or collapse independent provider observations; add source-scoped idempotent INSERT + outbox within one transaction. Migration adds role grants without editing 001; PostGIS extension setup must be explicit and permission-reviewed.

#### Tests and proof
Test concurrent same delivery, same coords/different provider, out-of-order, null fields, invalid geometry, rollback after outbox error, restricted runtime cannot update immutable data.

#### Agent execution steps
1. Confirm immediate predecessor DONE; in the existing issue status log record UTC date, branch, owner, intended changed files and prerequisites. Set IN PROGRESS **before coding**.
2. Add validated public contract + tests first. Add small pure rules separately from use-case orchestration; build adapters, persistence and API/UI last. Update public module exports, test fixtures and architecture gates only where justified.
3. Run `npm run check` and every issue-specific suite. Any SQL change requires real PG integration; any browser interaction requires Playwright. Report actual commands/results, not claimed CI. Verify privacy/data rights before using real feeds.
4. Record schema changes, constraints, concurrency handling, replay/idempotency, error responses, non-goals and how the next issue will consume the resulting interface.
5. Open one focused PR, set IN REVIEW and link it, tick accepted checkboxes only with evidence; after merge record commit and actual tests, set DONE/close, then update #4 and activate exactly the next issue. A blocked provider/permission keeps this issue BLOCKED with an exact action to unblock.

#### Delivery gate
A runnable vertical behavior within this task, unit/contract tests, negative/failure cases and applicable DB/browser checks are mandatory; no fake live data, no empty scaffolding and no public exposure of unlicensed messages.

### Agent implementation blueprint (2026-11-19)

> **Verified baseline:** `main@373a2755` (Stage2). Some paths referenced below exist only after predecessor issues; all **create** paths are proposed. Do not claim a source, contract or SQL table exists until merged.

#### Read existing code / predecessor output
- `db/migrations/001_durable_correlation.sql`
- `scripts/postgres/migrate.mjs`
- `scripts/postgres/run-integration.mjs`
- `packages/backend/src/contracts/database/sql-executor.ts`
- `packages/backend/src/modules/database-transactions/public/index.ts`

#### Create or extend these files (single responsibility per unit)
- `db/migrations/<next>_tracking_observations.sql`
- `packages/backend/src/modules/flight-tracking/ports/{position-writer.ts,position-history-reader.ts}`
- `packages/backend/src/modules/flight-tracking/infrastructure/postgres/{append-position.ts,query-position-history.ts}`
- `packages/backend/tests/integration/position-persistence.test.mjs`

#### Types, database or API contract to implement
1. New `tracking.position_observations` proposed columns: internal PK; unique `(source_id,source_epoch,external_observation_id)` when provider guarantees stability; `observed_at_ms`, `received_at_ms`, `lat`, `lon`, optional altitude/heading/speed with explicit unit/type, measurement kind, quality and source delivery reference.
2. Use PostGIS geometry(Point,4326) or an equivalent validated spatial strategy with GiST index; create `postgis` extension through migrations using appropriate privileges, and document any required managed-DB preinstall step.
3. Do not use `aircraftId` as mandatory until Stage4 #17 identity registry exists; store actual identifiers and link decisions separately. Capture immutable fact+outbox atomically if a tracking event is emitted.

#### Implementation sequence for the agent
- **1.** Before SQL authoring inspect the latest numbered migration (Stage3 may have added 002+) and migration ownership grants; choose the next unused number, never rewrite an applied migration.
- **2.** Create schema `tracking` with `tv_tracking_owner NOLOGIN`; grant only specific SQL verbs to existing restricted runtime role; enforce coordinate and timestamp checks.
- **3.** Implement `appendPosition(observation)` as a single transaction, with uniqueness and immutable canonical fingerprint, plus an explicit conflict when same provider ID has different bytes.
- **4.** Write bounded `readHistory({identityHints,from,to,limit,cursor})` using deterministic sort `(observed_at_ms, observation_id)` and stable keyset pagination.
- **5.** Add spatial/time indexes with SQL EXPLAIN test fixtures; record data retention requirement but do not implement deletion here.

#### Mandatory regression scenarios
- Real PostgreSQL integration: invalid geometry rejected; duplicate event idempotent across restart; conflicting reuse rejected; different sources retained.
- Concurrent same-key insertion and producer-outbox failure rollback; no partial history.
- Longitude edge/antimeridian bbox handled by appropriate query segmentation; query plan uses spatial/time index under synthetic load.

#### Integration boundary
Do not create current-position status or aircraft assignments here. Identity linkage is #17; current selection is #18.

#### Merge evidence and status update
- Preserve/complete the issue's original acceptance checklist; link merged PR, actual commands/results, local versus remote CI, and migration/rollback notes.
- Update this issue's status log and EPIC #4 in sequence. Do not activate another issue before merge and acceptance.
- Maintain English docs/comments/UI text and follow `AGENTS.md`; update `docs/IMPLEMENTATION_STATUS.md` as needed.


---

## 13. [#17] Implement temporal aircraft identity registry and position linkage

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/17  
**Phase:** Stage 4 · Flight positions and map  
**Snapshot status:** IN REVIEW · **Dependency:** Issue #16 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Active PR #66; test latest head and merge before marking DONE.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 13 · **Stage 4 — Positions & private map MVP** · **Status:** IN REVIEW
> **Blocked by:** #16. Complete and verify the predecessor before starting this issue.

### Objective / deliverable
Physical aircraft identity is stable across sources and alias changes, and historical observations use identifiers valid at the observation time.

### Implementation instructions
1. Introduce internal `AircraftId` rows and time-qualified ICAO24/registration assertions with source, validity and revision history.
2. Resolve identities at observedAt rather than import time; retain conflicting/ambiguous assertions without selecting arbitrary owners.
3. Link positions to resolved aircraft with a versioned decision; keep unmatched facts for later replay.
4. Adapt correlation candidate reads to the registry's public interface, preserving complete/partial candidate distinction.
5. Create backfill/re-evaluation contract when aliases are corrected; avoid destructive history rewrites.

### Intended code / documentation ownership
`fleet-identity` context, migrations, alias resolution/read ports.

### Required verification
- Aircraft alias change, duplicate active ownership, historical backfill, registration normalization and two competing identifiers.
- Real DB unique/race and immutable-history integration tests.

### Acceptance checklist
- Messages and positions can reference a stable internal aircraft.
- Ambiguity remains explicit; no false confirmed flight or aircraft inferred.
- Historic observations survive identity corrections.
- Reviewed PR merged; verification commands/results, migration impact and limitations linked in this issue.

### Explicit non-goals
Flight-session recognition is Stage6.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Baseline inspection and implementation ownership
- Read `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md`, direct predecessor issue and its merged PR, plus: `modules/aircraft-correlation/domain/{temporal-alias,decide-aircraft-match,catalog-conflict}.ts`, `demo/infrastructure/fixture-candidate-directory.ts`.
- Proposed creation/updates: `modules/fleet-identity/{domain,application,ports,infrastructure/postgres}`, additive migration. These paths denote **new modules** unless already present on current main; inspect the tree before writing. The Stage2 backend exists; live positions, PostGIS and `apps/web` are not baseline features.
- Preserve existing TypeScript strict mode, typed identifiers, `Result`, architecture checker and narrow port/adapters. No cross-context deep imports or monolithic controller containing domain rules.

#### Precise data/API contract
`AircraftIdentityAssertion` records `source`, `validFrom`, `validUntil`, `recordedAt`, `supersededAt`, issuer, ICAO24/registration and internal `AircraftId`. Resolution result must distinguish MATCHED/AMBIGUOUS/CONFLICTED/UNMATCHED/INCOMPLETE.

#### Required algorithm and error handling
Resolve aliases at observation time and select complete candidate sets; corrections append new revisions and enqueue re-evaluation. Never use current registration blindly for historical messages; don't mutate original position facts.

#### Tests and proof
Temporal alias crossing, conflicting overlapping source assertions, simultaneous insert, old ICAO alias reused, missing candidate completeness and rollback tests.

#### Agent execution steps
1. Confirm immediate predecessor DONE; in the existing issue status log record UTC date, branch, owner, intended changed files and prerequisites. Set IN PROGRESS **before coding**.
2. Add validated public contract + tests first. Add small pure rules separately from use-case orchestration; build adapters, persistence and API/UI last. Update public module exports, test fixtures and architecture gates only where justified.
3. Run `npm run check` and every issue-specific suite. Any SQL change requires real PG integration; any browser interaction requires Playwright. Report actual commands/results, not claimed CI. Verify privacy/data rights before using real feeds.
4. Record schema changes, constraints, concurrency handling, replay/idempotency, error responses, non-goals and how the next issue will consume the resulting interface.
5. Open one focused PR, set IN REVIEW and link it, tick accepted checkboxes only with evidence; after merge record commit and actual tests, set DONE/close, then update #4 and activate exactly the next issue. A blocked provider/permission keeps this issue BLOCKED with an exact action to unblock.

#### Delivery gate
A runnable vertical behavior within this task, unit/contract tests, negative/failure cases and applicable DB/browser checks are mandatory; no fake live data, no empty scaffolding and no public exposure of unlicensed messages.

### Agent implementation blueprint (2026-11-19)

> **Verified baseline:** `main@373a2755` (Stage2). Some paths referenced below exist only after predecessor issues; all **create** paths are proposed. Do not claim a source, contract or SQL table exists until merged.

#### Read existing code / predecessor output
- `packages/backend/src/modules/aircraft-correlation/domain/{icao24.ts,temporal-alias.ts,catalog-conflict.ts}`
- `packages/backend/src/modules/aircraft-correlation/ports/candidate-directory.ts`
- `packages/backend/src/contracts/identity/aircraft-id.ts`
- `packages/backend/src/demo/infrastructure/fixture-candidate-directory.ts`

#### Create or extend these files (single responsibility per unit)
- `packages/backend/src/modules/fleet-identity/domain/{aircraft.ts,identity-assertion.ts,alias-validity.ts,resolve-identity-at.ts}`
- `packages/backend/src/modules/fleet-identity/ports/{identity-reader.ts,identity-committer.ts}`
- `packages/backend/src/modules/fleet-identity/infrastructure/postgres/`
- `db/migrations/<next>_fleet_identity.sql`
- `packages/backend/tests/integration/temporal-identity.test.mjs`

#### Types, database or API contract to implement
1. `AircraftId` is internal and stable, not necessarily same as ICAO24. Record `IdentityAssertion {aircraftId,kind,value,validFrom,validUntil,recordedAt,sourceId,revision}`; half-open valid intervals `[from, until)`.
2. `resolveAircraft(identifier,time)` must return a tagged result: `UNIQUE(aircraftId,revision)`, `AMBIGUOUS(candidateIds)`, `UNMATCHED`, or `INDEX_INCOMPLETE`. Index errors must never be silently converted into no match.
3. Store position→aircraft link separately from immutable position facts and retain link history; identity correction triggers replay/re-evaluation via public event, not mutation of observation payload.

#### Implementation sequence for the agent
- **1.** Introduce fleet-identity context with pure alias/time lookup and conflict veto, reusing validated ICAO24 and registration constructors from existing correlation public surface.
- **2.** Design migrations with NOLOGIN owner, immutable alias assertions, versioned link heads and indexes for `(kind,normalizedAlias,validFrom,validUntil)`; avoid destructive merge of aircraft rows.
- **3.** Build a complete `CandidateDirectory` adapter on identity data with revision/checkpoint for correlator; do not allow partial sample to be marked COMPLETE.
- **4.** Implement idempotent position-link decisions and bounded reprocessing when alias owner/time is corrected; keep the old event evidence.
- **5.** Update synthetic demo adapters only at public interfaces to avoid breaking existing 158 regressions.

#### Mandatory regression scenarios
- Alias switches from aircraft A to B exactly at validity boundary; historic position resolves to prior owner.
- Two simultaneously valid aliases produce ambiguity; stale/partial catalog error is not UNMATCHED.
- Concurrent identity assertion conflict and projection repair; histories and source provenance preserved.

#### Integration boundary
Do not start flight-session segmentation: that is Stage6 #34. Avoid forcing route/flight identifiers into the physical aircraft registry.

#### Merge evidence and status update
- Preserve/complete the issue's original acceptance checklist; link merged PR, actual commands/results, local versus remote CI, and migration/rollback notes.
- Update this issue's status log and EPIC #4 in sequence. Do not activate another issue before merge and acceptance.
- Maintain English docs/comments/UI text and follow `AGENTS.md`; update `docs/IMPLEMENTATION_STATUS.md` as needed.


---

## 14. [#18] Maintain the current-position projection with independent freshness

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/18  
**Phase:** Stage 4 · Flight positions and map  
**Snapshot status:** BACKLOG · **Dependency:** Issue #17 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 14 · **Stage 4 — Positions & private map MVP** · **Status:** BACKLOG
> **Blocked by:** #17. Complete and verify the predecessor before starting this issue.

### Objective / deliverable
The map has one best position per aircraft, without allowing older or poorer observations to overwrite newer reliable ones.

### Implementation instructions
1. Define a deterministic position-ranking policy using observedAt, quality, provider priority and explicit tie-breaker.
2. Consume position events idempotently and update current position and projection revision atomically.
3. Expose position freshness/unknown from the server clock independent of message availability.
4. Handle stale, missing and conflicting positions without silently placing the aircraft at (0,0) or treating old positions as current.
5. Support repair/rebuild from append-only observations for a single aircraft and a bounded time horizon.

### Intended code / documentation ownership
`flight-tracking/application/current-position`, projection writer/read ports.

### Required verification
- Reordered arrival, equal-time quality conflict, duplicate event, source loss and projection rebuild.
- SQL transaction/rollback tests and exact freshness boundary tests.

### Acceptance checklist
- Latest-position result is deterministic and safely rebuildable.
- Out-of-order observations cannot regress current state.
- Communication status is unchanged by positional updates.
- Reviewed PR merged; verification commands/results, migration impact and limitations linked in this issue.

### Explicit non-goals
No route history or map tiles.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Baseline inspection and implementation ownership
- Read `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md`, direct predecessor issue and its merged PR, plus: `modules/message-availability/domain/classify-age.ts`, `modules/event-delivery/infrastructure/consume-event.ts`, new position tables from #16.
- Proposed creation/updates: `modules/flight-tracking/application/select-current-position.ts`, `infrastructure/postgres/current-position-projection.ts`. These paths denote **new modules** unless already present on current main; inspect the tree before writing. The Stage2 backend exists; live positions, PostGIS and `apps/web` are not baseline features.
- Preserve existing TypeScript strict mode, typed identifiers, `Result`, architecture checker and narrow port/adapters. No cross-context deep imports or monolithic controller containing domain rules.

#### Precise data/API contract
Per aircraft current position row records positionEventId, observation time, quality precedence, update revision and next freshness decision; separate from message status contribution state.

#### Required algorithm and error handling
Create deterministic pure ranking `(eventTime, quality, stable source tie-break)`; consumer inbox and current row update atomically. Late messages never refresh position; old positions never replace recent reliable ones. Provide rebuild from immutable history.

#### Tests and proof
Same timestamp conflict, poor-quality later observation policy, duplicate event, old re-delivery, restart, stale/unknown transition and PG CAS tests.

#### Agent execution steps
1. Confirm immediate predecessor DONE; in the existing issue status log record UTC date, branch, owner, intended changed files and prerequisites. Set IN PROGRESS **before coding**.
2. Add validated public contract + tests first. Add small pure rules separately from use-case orchestration; build adapters, persistence and API/UI last. Update public module exports, test fixtures and architecture gates only where justified.
3. Run `npm run check` and every issue-specific suite. Any SQL change requires real PG integration; any browser interaction requires Playwright. Report actual commands/results, not claimed CI. Verify privacy/data rights before using real feeds.
4. Record schema changes, constraints, concurrency handling, replay/idempotency, error responses, non-goals and how the next issue will consume the resulting interface.
5. Open one focused PR, set IN REVIEW and link it, tick accepted checkboxes only with evidence; after merge record commit and actual tests, set DONE/close, then update #4 and activate exactly the next issue. A blocked provider/permission keeps this issue BLOCKED with an exact action to unblock.

#### Delivery gate
A runnable vertical behavior within this task, unit/contract tests, negative/failure cases and applicable DB/browser checks are mandatory; no fake live data, no empty scaffolding and no public exposure of unlicensed messages.

### Agent implementation blueprint (2026-11-19)

> **Baseline:** Stage2 `main@373a2755`. Where a previous issue creates a path, read the actual merged implementation rather than assuming the proposed path exists. Every new path below is illustrative and belongs to this issue only.

#### Existing references to read
- `packages/backend/src/modules/message-availability/domain/{classify-age.ts,derive-availability.ts}`
- `packages/backend/src/modules/database-transactions/public/index.ts`
- `packages/backend/src/contracts/identity/index.ts`
- `Output of #16 positions + #17 stable aircraft-link registry`

#### File-level plan / expected owners
- `packages/backend/src/modules/flight-tracking/domain/{compare-position-evidence.ts,select-current-position.ts,classify-position-age.ts}`
- `packages/backend/src/modules/flight-tracking/application/update-current-position.ts`
- `packages/backend/src/modules/flight-tracking/ports/current-position-reader.ts`
- `packages/backend/src/modules/flight-tracking/infrastructure/postgres/current-position-projection.ts`
- `packages/backend/tests/integration/current-position.test.mjs`

#### Explicit model, SQL, or wire contracts
1. Proposed `CurrentPosition {aircraftId,observationId,observedAt,quality,sourceId,position,revision,calculatedAt}` with `PositionFreshness` independent from `MessageFreshness`. A missing position is `UNKNOWN`, not latitude/longitude zero.
2. Implement deterministic ranking: favor latest trustworthy observedAt, then evidence/measurement quality and documented source priority, finally stable observation ID. **Do not let a later arrival time outrank a newer observation timestamp.**
3. A position projection update is idempotent on `(aircraftId,observationId,sourceEventRevision)` and version-fenced; include a rebuild/checkpoint procedure after identity reassignment.

#### Agent task sequence
- **Step 1.** Write a pure `comparePositionEvidence` with a documented ordering policy and refusal rules for implausible coordinates; design quality tie behavior, not random arrival order.
- **Step 2.** Store `tracking.current_position` plus projection revision with one transaction; consume tracking events through inbox/outbox using the existing durable queue semantics (integrate multi-owner route from #11).
- **Step 3.** When an older/out-of-order update arrives, retain history but return a non-mutating projection outcome. When an identity link is corrected, recompute from valid facts rather than patch the current field by guesswork.
- **Step 4.** Implement `positionFreshness(now,observationAt)` and expiry/recheck on reads, with status not altering radio-message contribution timestamps.
- **Step 5.** Add bounded API-facing read port, missing/unknown position variant and quality/age metadata; avoid direct SQL in domain or frontend.

#### Required tests and edge cases
- Older high-quality and newer lower-quality observations: deterministic, documented tie resolution.
- Equal timestamps, duplicate, MLAT-vs-ADS-B, conflicting aliases and identity correction rebuild; crash between inbox and projection rollback.
- Loss of source connection cannot make an old coordinate recent; `message-availability` colors unaffected.
- `npm run check` + real PostgreSQL integration (projection revision and out-of-order facts).

#### Ownership / handoff
Track-history simplification is #19; map API projection is #20. Do not collapse position state into message freshness.

#### Completion evidence
- Update original acceptance boxes; link merged PR + SHA, real test output, migration number/rollback path and known limits.
- Keep status history in THIS issue, check it in EPIC #4 after verification and activate only the next dependency.
- Preserve English, strict SRP boundaries and correct local-versus-remote CI status; update implementation documentation when scope changes.


---

## 15. [#19] Build observed flight-track history and map-scale simplification

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/19  
**Phase:** Stage 4 · Flight positions and map  
**Snapshot status:** BACKLOG · **Dependency:** Issue #18 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 15 · **Stage 4 — Positions & private map MVP** · **Status:** BACKLOG
> **Blocked by:** #18. Complete and verify the predecessor before starting this issue.

### Objective / deliverable
Users can inspect the path actually observed for an aircraft rather than a guessed scheduled route.

### Implementation instructions
1. Read positions in deterministic observed-time order with keyset pagination and explicit source/time quality metadata.
2. Split discontinuities across excessive time gaps and implausible geometry; do not bridge unknown track gaps.
3. Implement zoom/point-budget simplification as a pure deterministic function; preserve endpoints and actual observed segments.
4. Provide bounded history query contracts and no guessed airport destination or flight number.
5. Document how antimeridian crossings and missing points are represented in map geometries.

### Intended code / documentation ownership
`flight-tracking/application/observed-track` and geometry/serialization readers.

### Required verification
- Property/fixture tests for time gaps, large track budgets, antimeridian and repeat/out-of-order points.
- Database history query and paging integration tests.

### Acceptance checklist
- Track returns only observed geometry with explicit gaps.
- Simplified results are stable for fixed inputs and stay within size limits.
- No fake planned routes appear in API/UI.
- Reviewed PR merged; verification commands/results, migration impact and limitations linked in this issue.

### Explicit non-goals
Flight-session segmentation and historical analysis remain Stage6.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Baseline inspection and implementation ownership
- Read `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md`, direct predecessor issue and its merged PR, plus: `modules/flight-tracking` position reader and current position projection from #18.
- Proposed creation/updates: `modules/flight-tracking/application/{build-observed-track,simplify-track}.ts`, track reader port. These paths denote **new modules** unless already present on current main; inspect the tree before writing. The Stage2 backend exists; live positions, PostGIS and `apps/web` are not baseline features.
- Preserve existing TypeScript strict mode, typed identifiers, `Result`, architecture checker and narrow port/adapters. No cross-context deep imports or monolithic controller containing domain rules.

#### Precise data/API contract
Track result is `{aircraftId, segments:[{points:[lat,lon,time,source], gapReason?}], hasMore, cursor}`; source observation history, not scheduled route. Limit points/request, sort by `(observedAt,id)` and preserve source quality.

#### Required algorithm and error handling
Split based on explicit time/distance gap policy and impossible position jumps, simplify Douglas-Peucker or similar deterministic algorithm without collapsing segment boundaries. Reproject to antimeridian-safe sequences.

#### Tests and proof
Known gap test, 180-degree crossing, identical coordinates, out-of-order, large result budget, cursor edge and no fabricated origin/destination.

#### Agent execution steps
1. Confirm immediate predecessor DONE; in the existing issue status log record UTC date, branch, owner, intended changed files and prerequisites. Set IN PROGRESS **before coding**.
2. Add validated public contract + tests first. Add small pure rules separately from use-case orchestration; build adapters, persistence and API/UI last. Update public module exports, test fixtures and architecture gates only where justified.
3. Run `npm run check` and every issue-specific suite. Any SQL change requires real PG integration; any browser interaction requires Playwright. Report actual commands/results, not claimed CI. Verify privacy/data rights before using real feeds.
4. Record schema changes, constraints, concurrency handling, replay/idempotency, error responses, non-goals and how the next issue will consume the resulting interface.
5. Open one focused PR, set IN REVIEW and link it, tick accepted checkboxes only with evidence; after merge record commit and actual tests, set DONE/close, then update #4 and activate exactly the next issue. A blocked provider/permission keeps this issue BLOCKED with an exact action to unblock.

#### Delivery gate
A runnable vertical behavior within this task, unit/contract tests, negative/failure cases and applicable DB/browser checks are mandatory; no fake live data, no empty scaffolding and no public exposure of unlicensed messages.

### Agent implementation blueprint (2026-11-19)

> **Baseline:** Stage2 `main@373a2755`. Where a previous issue creates a path, read the actual merged implementation rather than assuming the proposed path exists. Every new path below is illustrative and belongs to this issue only.

#### Existing references to read
- `Stage4 #16 history reader & indexes`
- `Stage4 #18 current-position reader`
- `packages/backend/src/contracts/database/sql-executor.ts`
- `docs/architecture/ARCHITECTURE_V2.md §4 / observed track`

#### File-level plan / expected owners
- `packages/backend/src/modules/flight-tracking/domain/{split-track-segments.ts,simplify-track.ts,longitude-wrap.ts}`
- `packages/backend/src/modules/flight-tracking/application/get-observed-track.ts`
- `packages/backend/src/modules/flight-tracking/ports/track-history-reader.ts`
- `packages/backend/tests/observed-track.test.mjs`
- `packages/backend/tests/integration/track-pagination.test.mjs`

#### Explicit model, SQL, or wire contracts
1. Observed track response shape: `{aircraftId,from,to,segments:[{points:[{observedAt,lat,lon,observationId}],gapBeforeReason?}],nextCursor?}`. It must identify **observed** points only; no scheduled destination or implied complete route.
2. For geometry, split at provider time gaps, invalid speeds or long missing periods rather than connecting a misleading straight line. Decide a threshold with tests and document its version.
3. For high map zoom budgets, use deterministic Ramer–Douglas–Peucker or equivalent segment-local simplifier, preserve segment endpoints and temporal order and never merge across antimeridian incorrectly.

#### Agent task sequence
- **Step 1.** Implement a bounded SQL history reader over positions linked to an aircraft with `(observed_at_ms,position_id)` stable keyset cursor; validate maximum range/limit and scope.
- **Step 2.** Build pure track segments. Detect antimeridian crossing with normalized longitude representation and segment continuity rules.
- **Step 3.** Write simplifier with configurable max vertices per segment / tolerance by zoom and explicit unit; preserve original observations for full history.
- **Step 4.** Expose a use case that resolves the current aircraft identity and returns approved bounded observed segments with metadata and a continuation token.
- **Step 5.** Document the time/area limitations, gaps and uncertainty for frontend; keep render data separate from domain data.

#### Required tests and edge cases
- Same-time distinct points maintain deterministic order; late position backfill and missing window do not invent geometry.
- Antimeridian +179→-179, pole-edge validation, empty or single-point track, long gap split, high-volume simplification endpoint preservation.
- Pagination no duplicate/no skipped ID under stable history; SQL indexes exercised with real PostgreSQL.
- Unit property checks for monotonic timestamps, max vertex budget and stable simplification.

#### Ownership / handoff
No provider-specific route heuristics or FlightSession segmentation (#34). This issue returns geometry; #22 decides how to render it.

#### Completion evidence
- Update original acceptance boxes; link merged PR + SHA, real test output, migration number/rollback path and known limits.
- Keep status history in THIS issue, check it in EPIC #4 after verification and activate only the next dependency.
- Preserve English, strict SRP boundaries and correct local-versus-remote CI status; update implementation documentation when scope changes.


---

## 16. [#20] Create a scoped bbox map projection and coherent HTTP snapshot

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/20  
**Phase:** Stage 4 · Flight positions and map  
**Snapshot status:** BACKLOG · **Dependency:** Issue #19 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 16 · **Stage 4 — Positions & private map MVP** · **Status:** BACKLOG
> **Blocked by:** #19. Complete and verify the predecessor before starting this issue.

### Objective / deliverable
An internal API can serve a bounded viewport of current aircraft with independent position/message statuses.

### Implementation instructions
1. Build a denormalized per-aircraft internal map read model composed from current-position and authorized-safe demo status inputs.
2. Validate bbox ranges, antimeridian splits, pagination/limits, status and protocol filters; reject unsupported parameters.
3. Return a coherent snapshot with position observation time, message observation time, coverage and feed health as separate fields.
4. Index spatial/filtered queries and enforce bounded counts and response sizes; no global unbounded list.
5. Restrict this pre-Stage5 endpoint to internal/loopback demonstration data; never leak real restricted message contents.

### Intended code / documentation ownership
`read-models/map-projection`, `apps/api/src/routing`, SQL migration and DTO contracts.

### Required verification
- Real DB bbox edges, antimeridian, empty viewport, stale status, high marker count and malformed query tests.
- API contract tests for pagination/limits and no hidden data leakage.

### Acceptance checklist
- HTTP viewport snapshot is documented and consistent.
- Large areas cannot bypass query budgets.
- Position and communication status semantics remain independent.
- Reviewed PR merged; verification commands/results, migration impact and limitations linked in this issue.

### Explicit non-goals
No WebSocket synchronization; Stage5 will introduce scope-aware event log.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Baseline inspection and implementation ownership
- Read `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md`, direct predecessor issue and its merged PR, plus: `apps/api/src/routing/{match-route,handle-request}.ts`, `demo/application/assemble-aircraft-summary.ts`, `modules/message-availability/infrastructure/postgres-availability-reader.ts`.
- Proposed creation/updates: `modules/read-models/map`, `apps/api/src/routing/map-aircraft.ts`, spatial SQL migration if needed. These paths denote **new modules** unless already present on current main; inspect the tree before writing. The Stage2 backend exists; live positions, PostGIS and `apps/web` are not baseline features.
- Preserve existing TypeScript strict mode, typed identifiers, `Result`, architecture checker and narrow port/adapters. No cross-context deep imports or monolithic controller containing domain rules.

#### Precise data/API contract
`GET /api/v1/map/aircraft?bbox=west,south,east,north&limit=N&cursor=...` returns bounded snapshot `{items:[{aircraftId,position,status,coverage,health}],checkpoint?}` with independent times and explicit unknowns.

#### Required algorithm and error handling
Validate bbox/antimeridian, limit<=documented max, keyset sorting and allowable filters before SQL; avoid joining unapproved restricted real messages into public data. At this stage run loopback/private only; Stage5 scopes required for public.

#### Tests and proof
Spatial bbox/antimeridian and empty result, limit pagination, malformed filter 400, status leak tests; PostgreSQL EXPLAIN/budget.

#### Agent execution steps
1. Confirm immediate predecessor DONE; in the existing issue status log record UTC date, branch, owner, intended changed files and prerequisites. Set IN PROGRESS **before coding**.
2. Add validated public contract + tests first. Add small pure rules separately from use-case orchestration; build adapters, persistence and API/UI last. Update public module exports, test fixtures and architecture gates only where justified.
3. Run `npm run check` and every issue-specific suite. Any SQL change requires real PG integration; any browser interaction requires Playwright. Report actual commands/results, not claimed CI. Verify privacy/data rights before using real feeds.
4. Record schema changes, constraints, concurrency handling, replay/idempotency, error responses, non-goals and how the next issue will consume the resulting interface.
5. Open one focused PR, set IN REVIEW and link it, tick accepted checkboxes only with evidence; after merge record commit and actual tests, set DONE/close, then update #4 and activate exactly the next issue. A blocked provider/permission keeps this issue BLOCKED with an exact action to unblock.

#### Delivery gate
A runnable vertical behavior within this task, unit/contract tests, negative/failure cases and applicable DB/browser checks are mandatory; no fake live data, no empty scaffolding and no public exposure of unlicensed messages.

### Agent implementation blueprint (2026-11-19)

> **Baseline:** Stage2 `main@373a2755`. Where a previous issue creates a path, read the actual merged implementation rather than assuming the proposed path exists. Every new path below is illustrative and belongs to this issue only.

#### Existing references to read
- `apps/api/src/routing/{route.ts,match-route.ts,handle-request.ts}`
- `apps/api/src/http/{send-api-result.ts,http-problem.ts}`
- `packages/backend/src/demo/public/types.ts`
- `Stage4 #18 `CurrentPosition` and Stage4 #17 identity links`

#### File-level plan / expected owners
- `packages/backend/src/modules/read-models/{domain,map,application,ports,public}/ (select one coherent module shape, no empty scaffolding)`
- `packages/backend/src/modules/read-models/infrastructure/postgres/map-projection-reader.ts`
- `apps/api/src/routing/map-viewport.ts`
- `db/migrations/<next>_map_read.sql`
- `apps/api/tests/integration/map-viewport.test.mjs`

#### Explicit model, SQL, or wire contracts
1. Propose **internal** `GET /api/v1/internal/map/aircraft?bbox=minLon,minLat,maxLon,maxLat&limit=500&cursor=...` with strict query validation, max bbox, documented pagination and response `{data:[{aircraftId,position:{lat,lon,observedAt,freshness,source},messages:{freshness,lastMessageAt,coverage,feedHealth}}],nextCursor?,asOf}`.
2. Antimeridian bbox may be split into two ranges; forbid reversed latitude, non-finite coordinates, absurd zoom/area or overlarge limits. An unknown position is omitted from spatial marker list but remains available to details API.
3. Use only *private authorized* or explicitly synthetic message status until Stage5. Source global availability counts cannot be published by this pre-policy snapshot; no arbitrary client-supplied visibilityScope.

#### Agent task sequence
- **Step 1.** Define scoped read-model DTO, bbox validation and independent position/message timestamps as pure functions; avoid importing HTTP into read-model domain.
- **Step 2.** Build versioned denormalized map row/table from current position and permitted message contributions, with a replace/update mechanism that does not require expensive joins per pan.
- **Step 3.** Create bounded PostgreSQL bbox reader with geometry index, stable pagination and query cancellation budget; prove no unbounded `SELECT *`.
- **Step 4.** Add explicit new route and handler through existing `ApiRoute`/`matchRoute`/`handleRequest`. Keep existing six demo endpoints backward compatible.
- **Step 5.** Add input limit, loopback/private gate, stable error envelope, schema docs and tests with a dozen markers crossing bbox/antimeridian.

#### Required tests and edge cases
- GET validation: missing/non-numeric bbox, wrong coordinate count, reversed latitude, overlarge limit, unsupported filter.
- Bbox matching at edges and antimeridian, stale position/RECENT message independent, page cursor stability, zero results.
- Private-only gate/no real provider payload leakage; real DB index and consistency integration test.

#### Ownership / handoff
No web application or WebSocket here. Stage5 introduces scope-qualified map change log and public authorization; do not pretend private URL path alone is production security.

#### Completion evidence
- Update original acceptance boxes; link merged PR + SHA, real test output, migration number/rollback path and known limits.
- Keep status history in THIS issue, check it in EPIC #4 after verification and activate only the next dependency.
- Preserve English, strict SRP boundaries and correct local-versus-remote CI status; update implementation documentation when scope changes.


---

## 17. [#21] Establish the minimal React frontend shell and shared design primitives

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/21  
**Phase:** Stage 4 · Flight positions and map  
**Snapshot status:** BACKLOG · **Dependency:** Issue #20 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 17 · **Stage 4 — Positions & private map MVP** · **Status:** BACKLOG
> **Blocked by:** #20. Complete and verify the predecessor before starting this issue.

### Objective / deliverable
A single consistent light-mode UI replaces disconnected mockups while sharing typography, spacing, navigation and state conventions.

### Implementation instructions
1. Create Vite/React/TypeScript workspace with separate application composition and feature folders.
2. Implement CSS tokens for spacing, type scale, borders, status colors and compact responsive desktop panels; no decorative visual effects.
3. Build accessible generic Button, Input, Select, Panel, Table and skeleton/empty/error states with stable APIs.
4. Establish API client interfaces, loading/error boundaries and URL-based selection/filter state without duplicating business state.
5. Set up frontend strict type checks, lint/build scripts and Playwright/component test harness.

### Intended code / documentation ownership
`apps/web`, `design-system`, frontend routing and component tests.

### Required verification
- Frontend build, typography/layout snapshots at desktop and mobile widths.
- Keyboard focus, accessible names and empty/error state tests.

### Acceptance checklist
- Frontend runs against synthetic API responses with a consistent layout.
- Shared components are reusable without embedding aviation rules.
- Frontend checks are added to project CI.
- Reviewed PR merged; verification commands/results, migration impact and limitations linked in this issue.

### Explicit non-goals
No live provider data, MapLibre markers or flight panels in this task.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Baseline inspection and implementation ownership
- Read `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md`, direct predecessor issue and its merged PR, plus: `package.json` workspaces, `.github/workflows/ci.yml`, `docs/architecture/ARCHITECTURE_V2.md` frontend section.
- Proposed creation/updates: `apps/web/{package.json,src/app,src/design-system,src/features}`, `apps/web/tests`. These paths denote **new modules** unless already present on current main; inspect the tree before writing. The Stage2 backend exists; live positions, PostGIS and `apps/web` are not baseline features.
- Preserve existing TypeScript strict mode, typed identifiers, `Result`, architecture checker and narrow port/adapters. No cross-context deep imports or monolithic controller containing domain rules.

#### Precise data/API contract
Define UI tokens (spacing, font sizes, borders and semantic status palette), generic components `Button`, `Input`, `Panel`, `DataTable<Row>`, route state and one typed API client without aviation logic in UI primitives.

#### Required algorithm and error handling
Add Vite React/TS workspace and scripts; keep map/list/details desktop grid 3-column with mobile stacking, semantic focus/labels, loading/no-data/error states and basic server fixture; use typed DTOs at adapter boundary.

#### Tests and proof
Typecheck + build and Playwright component smoke at 1440/768/390 widths; screen reader names and keyboard focus tests; avoid snapshot-only validation.

#### Agent execution steps
1. Confirm immediate predecessor DONE; in the existing issue status log record UTC date, branch, owner, intended changed files and prerequisites. Set IN PROGRESS **before coding**.
2. Add validated public contract + tests first. Add small pure rules separately from use-case orchestration; build adapters, persistence and API/UI last. Update public module exports, test fixtures and architecture gates only where justified.
3. Run `npm run check` and every issue-specific suite. Any SQL change requires real PG integration; any browser interaction requires Playwright. Report actual commands/results, not claimed CI. Verify privacy/data rights before using real feeds.
4. Record schema changes, constraints, concurrency handling, replay/idempotency, error responses, non-goals and how the next issue will consume the resulting interface.
5. Open one focused PR, set IN REVIEW and link it, tick accepted checkboxes only with evidence; after merge record commit and actual tests, set DONE/close, then update #4 and activate exactly the next issue. A blocked provider/permission keeps this issue BLOCKED with an exact action to unblock.

#### Delivery gate
A runnable vertical behavior within this task, unit/contract tests, negative/failure cases and applicable DB/browser checks are mandatory; no fake live data, no empty scaffolding and no public exposure of unlicensed messages.

### Agent implementation blueprint (2026-11-19)

> **Baseline:** Stage2 `main@373a2755`. Where a previous issue creates a path, read the actual merged implementation rather than assuming the proposed path exists. Every new path below is illustrative and belongs to this issue only.

#### Existing references to read
- `package.json (existing workspaces backend/api only)`
- `packages/backend/package.json public exports`
- `apps/api/src/routing/route.ts`
- `scripts/architecture/{project.mjs,policy.mjs} (checker currently models backend/api only)`
- `docs/architecture/ARCHITECTURE_V2.md frontend section`

#### File-level plan / expected owners
- `apps/web/{package.json,index.html,vite.config.ts,tsconfig.json}`
- `apps/web/src/{app/App.tsx,app/routes.tsx,styles/tokens.css,styles/base.css}`
- `apps/web/src/shared/ui/{Button.tsx,Panel.tsx,Input.tsx,Select.tsx,DataTable.tsx}`
- `apps/web/tests/{component,visual,e2e}`
- `scripts/architecture/policy.mjs + project.mjs updates for web workspace`

#### Explicit model, SQL, or wire contracts
1. Shared design tokens should define spacing 4/8/12/16/24/32px, typography sizes, neutral foreground/background/borders and functional status colors. A reusable component has no aviation-specific imports.
2. Propose a typed API client boundary `ApiClient.request<T>(route,query,signal)` handling `{data}` and `{error:{code,message}}`; never bypass server authorization or persist sensitive payload in local storage.
3. Navigation: `Map`, `Flights`, `Stations` placeholders (clearly not implemented) within one shell; selection and filters reside in URL/query state with parsed defaults. **No fake live data**.

#### Agent task sequence
- **Step 1.** Add a pinned React/TypeScript/Vite dependency set to workspace and lockfile, plus `apps/web` scripts build/typecheck/test. Keep Node24 and existing npm scripts working.
- **Step 2.** Expand architecture checker *deliberately* to classify web source/layers and permitted imports; assert web cannot deep-import backend internals or access SQL adapters.
- **Step 3.** Create accessible design primitives with one CSS token system, focus states, disabled/loading states and no inline hard-coded theme variants in features.
- **Step 4.** Establish router/layout with shared top bar, left filter region and right details region sized proportionally; use a mocked typed API seam and documented fallback states.
- **Step 5.** Add Playwright/component harness and responsive 1440/1024/390 widths; test both light mode consistency and focus order.

#### Required tests and edge cases
- `npm ci`, root `npm run check`, new `npm run build --workspace=...`, frontend tests; verify lockfile committed.
- Component semantics: focus, keyboard, loading/error, long labels and no inaccessible color-only state.
- Architectural regression tests: backend must not import `apps/web` and web must not deep-import `packages/backend/src/...`.

#### Ownership / handoff
This issue establishes scaffolding with functioning accessible shell, not empty feature folders; #22 renders MapLibre and #23 supplies details.

#### Completion evidence
- Update original acceptance boxes; link merged PR + SHA, real test output, migration number/rollback path and known limits.
- Keep status history in THIS issue, check it in EPIC #4 after verification and activate only the next dependency.
- Preserve English, strict SRP boundaries and correct local-versus-remote CI status; update implementation documentation when scope changes.


---

## 18. [#22] Implement MapLibre viewport, aircraft markers and observed tracks

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/22  
**Phase:** Stage 4 · Flight positions and map  
**Snapshot status:** BACKLOG · **Dependency:** Issue #21 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 18 · **Stage 4 — Positions & private map MVP** · **Status:** BACKLOG
> **Blocked by:** #21. Complete and verify the predecessor before starting this issue.

### Objective / deliverable
The interactive map renders validated aircraft positions and real observed paths with correct selection and viewport behavior.

### Implementation instructions
1. Integrate MapLibre with a properly licensed configurable tile/style source; ensure failure/blank style is explained.
2. Render position markers with heading only when supplied; status colors reflect server-computed message freshness and include text/legend equivalents.
3. Fetch bounded bbox snapshots as viewport changes; debounce, cancel stale requests and update current marker state by identity.
4. Show observed track segments and gaps for the selected aircraft; do not invent route lines.
5. Synchronize selection with the URL and provide accessible map/list fallback on keyboard or failed map tiles.

### Intended code / documentation ownership
`apps/web/features/aircraft-map`, map layer adapters and view-model logic.

### Required verification
- Map layer unit tests, rapid viewport changes, selection persistence, empty results and stale request cancellation.
- Playwright browser test at desktop/mobile widths, with mocked tiles/network.

### Acceptance checklist
- Clicking an aircraft selects it; zoom/pan never creates duplicate/ghost markers.
- Observed track is accurately rendered with gaps.
- UI remains usable when map tiles fail.
- Reviewed PR merged; verification commands/results, migration impact and limitations linked in this issue.

### Explicit non-goals
Aircraft message-details/list UX is the next issue.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Baseline inspection and implementation ownership
- Read `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md`, direct predecessor issue and its merged PR, plus: `apps/web` primitives from #21, HTTP map endpoint #20, observed track #19.
- Proposed creation/updates: `apps/web/src/features/aircraft-map/{MapViewport,MapLayerAdapter,markers,observed-track,selection}.tsx`. These paths denote **new modules** unless already present on current main; inspect the tree before writing. The Stage2 backend exists; live positions, PostGIS and `apps/web` are not baseline features.
- Preserve existing TypeScript strict mode, typed identifiers, `Result`, architecture checker and narrow port/adapters. No cross-context deep imports or monolithic controller containing domain rules.

#### Precise data/API contract
Render MapLibre with licensed style URL and spatial bbox fetch; stable aircraftId keyed marker updates; selected `aircraftId` in URL; actual observed track segments with time/gap metadata.

#### Required algorithm and error handling
Debounce viewport changes, AbortController stale requests, separate map render state from business state, cleanup layers on unmount; if no tile style show fallback list and error. Marker bearing only if validated heading.

#### Tests and proof
Browser test click/selection, fast pan/zoom cancellation, no duplicate aircraft, line gaps and unknown state accessibility; mock tile/network.

#### Agent execution steps
1. Confirm immediate predecessor DONE; in the existing issue status log record UTC date, branch, owner, intended changed files and prerequisites. Set IN PROGRESS **before coding**.
2. Add validated public contract + tests first. Add small pure rules separately from use-case orchestration; build adapters, persistence and API/UI last. Update public module exports, test fixtures and architecture gates only where justified.
3. Run `npm run check` and every issue-specific suite. Any SQL change requires real PG integration; any browser interaction requires Playwright. Report actual commands/results, not claimed CI. Verify privacy/data rights before using real feeds.
4. Record schema changes, constraints, concurrency handling, replay/idempotency, error responses, non-goals and how the next issue will consume the resulting interface.
5. Open one focused PR, set IN REVIEW and link it, tick accepted checkboxes only with evidence; after merge record commit and actual tests, set DONE/close, then update #4 and activate exactly the next issue. A blocked provider/permission keeps this issue BLOCKED with an exact action to unblock.

#### Delivery gate
A runnable vertical behavior within this task, unit/contract tests, negative/failure cases and applicable DB/browser checks are mandatory; no fake live data, no empty scaffolding and no public exposure of unlicensed messages.

### Agent implementation blueprint (2026-11-19)

> **Baseline:** `main@373a2755` for Stage2; Stage4 paths depend on preceding merged issues. Proposed file names are implementation guidance and must be reconciled with actual code before writing.

#### Existing/predecessor contracts to inspect
- `apps/web/src/shared/ui from #21`
- `Stage4 #20 internal `/api/v1/internal/map/aircraft` snapshot DTO`
- `Stage4 #19 observed-track DTO`
- `docs/architecture/ARCHITECTURE_V2.md §15`

#### File-level ownership and new components
- `apps/web/src/features/aircraft-map/{MapViewport.tsx,useAircraftViewport.ts,AircraftLayer.ts,SelectedTrackLayer.ts,map-source.ts}`
- `apps/web/src/features/aircraft-selection/{useSelectedAircraft.ts,url-selection.ts}`
- `apps/web/tests/aircraft-map.spec.ts`
- `apps/web/src/styles/map.css`

#### Exact UI/API contracts and invariants
1. Render MapLibre with licensed configurable tile/style URL; do not ship a commercial style/key without permission or place private credentials in the client bundle. Provide a clearly labeled blank-map fallback.
2. `useAircraftViewport` must produce validated bbox from map events, debounce requests, cancel stale AbortController calls and cache by `(bbox,filters,permissionScope,projectionVersion)`; a late HTTP result from prior viewport must not replace new state.
3. Marker state is keyed by stable `AircraftId`. Heading is optional, track segments have explicit gaps, selection comes from URL. Status color+text distinguishes message freshness from position freshness and source connection health.

#### Implementation order
- **Step 1.** Start from the shell's single shared layout; integrate MapLibre in a map feature component and isolate map imperative APIs in adapter files.
- **Step 2.** Connect to #20 bounded viewport HTTP snapshot through the shared client; use request-generation ID and abort old requests on pan/zoom to avoid duplicate/out-of-order markers.
- **Step 3.** Build pure `aircraftToGeoJson`/layer styling functions with small selectable point symbols, route segments and null-safe alt/heading; keep aviation matching out of React.
- **Step 4.** Implement click/keyboard selection: update URL `aircraft` param, keep selected object when it leaves viewport and show `outside current viewport` rather than resetting silently.
- **Step 5.** Document tile/style license and failure behavior and connect a list/text alternative for map accessibility; ensure no large payload rendering in marker popup.

#### Mandatory verification / failure scenarios
- Mock map events pan/zoom rapid-fire: last request wins, listeners cleanup on unmount, no duplicate marker IDs.
- Viewport bbox crossing longitude 180; selected track segment gap and no fabricated destination; missing position omitted.
- Playwright at desktop/mobile with stubbed tile requests; click marker -> URL -> selected state persists after reload; keyboard list alternative.
- Frontend build, TS check and root architecture checks pass.

#### Explicit boundary
Do not expose real provider text in a popup; panel belongs to #23. Do not introduce WebSocket, which belongs to Stage5.

#### Issue closure evidence
- Update the original acceptance list plus this work plan; link a merged PR and tested commit, actual commands/results and known data/source restrictions.
- Update the issue status log and EPIC #4 counts and next task only after merge, review and verification; never claim CI passed if it did not run.
- Keep all authored text English and architectural imports compliant with `AGENTS.md`.


---

## 19. [#23] Build aircraft details, message timeline, flight list and filters

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/23  
**Phase:** Stage 4 · Flight positions and map  
**Snapshot status:** BACKLOG · **Dependency:** Issue #22 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 19 · **Stage 4 — Positions & private map MVP** · **Status:** BACKLOG
> **Blocked by:** #22. Complete and verify the predecessor before starting this issue.

Selecting an aircraft from the map or list shows only its matched, permitted messages within the selected time window. Show available reception time and feeder, and distinguish downlink, uplink and unknown direction when supported. A reused callsign alone cannot confirm a match. If a healthy source returns zero matches, show “No messages observed in this time window”. Show source failure separately.

### Selected-aircraft lookup delivery

Selecting a plane by map, list or restored URL must invoke the same bounded lookup by validated ICAO24 through the private application's normal entry point. In crawl mode use the on-demand Airframes rendered-page adapter from #9. In API mode surface source unavailable without contacting Airframes. Show only messages matched to the active selection and filters, including available receiver/time and direction. Cancel or ignore a previous lookup on selection change. Keep live preview transient. Exercise this path with a deterministic replacement at the provider boundary, including switching aircraft while a request is pending.

### Objective / deliverable
A single selected aircraft drives the map, list and message panel with consistent statuses and accessible interactions.

### Implementation instructions
1. Create details panel with ICAO24, registration, callsign, position timestamps, message freshness, source health and explicit unknowns.
2. Implement a bounded message timeline with source/protocol/time badges; decoded text viewer must never claim raw RF availability when absent.
3. Connect flight/aircraft table selection to map and URL; maintain one source of selected-aircraft truth.
4. Implement validated status/protocol/time filters with URL roundtrip and explicit empty/loading/error states.
5. Use existing authenticated-safe fixture/internal API contracts only; do not export data beyond rights.

### Intended code / documentation ownership
`apps/web/features/{aircraft-selection,flight-details,message-timeline,flight-list,flight-filters}`.

### Required verification
- Selection sync from map to list/panel and URL reload; filter roundtrip; message/no-message cases.
- Accessible keyboard navigation, long/sensitive-message truncation and mobile panel tests.

### Acceptance checklist
- Click-to-messages workflow functions end to end in a private environment.
- No mismatched colors, stale missing data or fabricated frame contents.
- UI matches agreed clean layout conventions.
- Reviewed PR merged; verification commands/results, migration impact and limitations linked in this issue.

### Explicit non-goals
Realtime WebSocket updates and general public access are Stage5.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Existing code to inspect
`apps/web` feature shell (#21), map selection (#22), existing API response types `packages/backend/src/demo/public/types.ts`. Read `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md` and the merged predecessor issue's PR. Paths below are proposed newly created modules unless present on current main.

#### Intended code changes
`apps/web/src/features/{aircraft-details,message-timeline,aircraft-list,flight-filters}/`. Keep small feature components; no generic widget may contain aviation policy.

#### Explicit contract
Single aircraft-selection value in URL drives map, table and details. Show ICAO, registration, callsign, last position time, radio freshness, feed health, source granularity, 500-row list limitation. Never invent `rawFrame` when source only supplies a decoded provider message.

#### Implementation order and error paths
Implement typed API client and filter serializer, error/loading/empty states and long payload escaping. Messages associated to aircraft but not a flight should still appear under aircraft; ambiguous correlation must not appear under a falsely confirmed flight.

#### Non-happy-path verification
Browser tests: selection sync, URL reload, filtered empty lists, stale position with recent message, unsafe text escaping, no raw RF data, mobile detail drawer.

#### Execution and handoff
1. Confirm predecessor DONE. In this issue's existing status section set IN PROGRESS with UTC date, owner, branch and files; retain original checkboxes.
2. Implement typed inputs and tests, pure rules, feature orchestration, infrastructure adapters and UI last. Preserve source rights and original observation timestamps.
3. Run `npm run check` and applicable real-PostgreSQL/Playwright tests, report actual commands, test counts and CI URL with accurate remote status.
4. Set IN REVIEW with linked PR, record migrations/rollback and residual limitations, check only verified conditions. After merge record SHA, set DONE/close, update EPIC #4 and activate next issue. Never skip a BLOCKED prerequisite.

### Agent implementation blueprint (2026-11-19)

> **Baseline:** `main@373a2755` for Stage2; Stage4 paths depend on preceding merged issues. Proposed file names are implementation guidance and must be reconciled with actual code before writing.

#### Existing/predecessor contracts to inspect
- `apps/web shared design primitives from #21`
- `Stage4 #22 map + selection state`
- `apps/api/src/routing/{route.ts,handle-request.ts} and Stage4 history/message routes`
- `packages/backend/src/demo/public/types.ts as legacy synthetic DTO only`

#### File-level ownership and new components
- `apps/web/src/features/aircraft-details/{AircraftDetailsPanel.tsx,AircraftFacts.tsx,StatusExplanation.tsx}`
- `apps/web/src/features/message-timeline/{MessageTimeline.tsx,MessageRow.tsx,MessagePayload.tsx}`
- `apps/web/src/features/flight-list/{FlightTable.tsx,useFlightList.ts}`
- `apps/web/src/features/flight-filters/{filter-model.ts,url-filters.ts}`
- `apps/web/tests/aircraft-detail-flow.spec.ts`

#### Exact UI/API contracts and invariants
1. All panels consume one stable selected AircraftId stored in URL. Aircraft object position timestamps, `freshness`, `coverage` and `feedHealth` are separate; never render unknown as a numeric zero or mislabel absence of observed communication as a transmission failure.
2. Decoded message row uses `messageId`, observedAt, bearer/protocol stack, source provenance, explicit `dataLevel`, correlation decision and allowed `summary|decoded|raw|withheld` field set. Do not offer a raw-frame tab unless a real permitted frame exists.
3. Query filters must parse/serialize with explicit defaults (bearer, freshness, time window, callsign/registration search) and produce stable API query keys, with no cross-scope cache reuse.

#### Implementation order
- **Step 1.** Build pure DTO-to-UI presenters first for statuses, data levels, age and withholding; keep all business classification server-side.
- **Step 2.** Implement detail panel with small grouped fields and labeled statuses; handle unknown flight session (Stage6 will add), unknown source and old position.
- **Step 3.** Create paginated/cursor message timeline with expand/collapse and safe text output. React text content must be escaped; no `dangerouslySetInnerHTML`.
- **Step 4.** Implement flights/aircraft data table with keyboard focus and accessible sorting/filters, using same selection ID as map. Note Stage4 may only know aircraft; label unconfirmed flight number as unknown.
- **Step 5.** Persist validated filters/selection in URL and reuse the shared API client; include empty/loading/error/network-offline and permission-denied states.

#### Mandatory verification / failure scenarios
- Map click changes table highlight + detail panel; list selection recenters/indicates off-map; reload restores selection and filters.
- Rendered message-only provider data never shows fake RF bytes, receiver coordinates or forbidden content.
- Two long messages, null callsign, unknown flight, old position with fresh messages; verify status labels and timestamps.
- Playwright mobile/desktop keyboard navigation, safe text rendering, loading/error and cross-scope cache invalidation.

#### Explicit boundary
All real-message data stays private under Stage4; #25–#33 add public policy and live streaming.

#### Issue closure evidence
- Update the original acceptance list plus this work plan; link a merged PR and tested commit, actual commands/results and known data/source restrictions.
- Update the issue status log and EPIC #4 counts and next task only after merge, review and verification; never claim CI passed if it did not run.
- Keep all authored text English and architectural imports compliant with `AGENTS.md`.


---

## 20. [#24] Verify the private live-map MVP end to end

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/24  
**Phase:** Stage 4 · Flight positions and map  
**Snapshot status:** BACKLOG · **Dependency:** Issue #23 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 20 · **Stage 4 — Positions & private map MVP** · **Status:** BACKLOG
> **Blocked by:** #23. Complete and verify the predecessor before starting this issue.

Browser acceptance: select aircraft A with a matched message, then aircraft B with none. Verify the timeline updates, stale A rows disappear, the empty state describes the observation window and a source outage has a distinct state.

### Selected-aircraft lookup delivery

Exercise the actual UI and private server together. In the offline run substitute only the Airframes provider boundary, exercise the two configured source strategies, and check a selected match, no receiver observations, and source failure. Record the offline result separately from the external criterion for a permitted genuine observation.

### Objective / deliverable
Stage4 is completed only when real permitted positions and messages can be inspected through a private interface.

### Implementation instructions
1. Start PostgreSQL, one authorized real message source, one position source, API and web frontend in a reproducible private development setup.
2. Trace one aircraft from live position observation through the map and link to an actual available decoded message.
3. Test missing/late messages, stale positions, restricted provider data, ambiguous identity and disconnected source states.
4. Record empirical latency, query budget, failure/reconnect behavior and current user-visible limitations.
5. Update Stage4 release notes and roadmap only after confirming the complete browser flow.

### Intended code / documentation ownership
`tests/e2e/private-map-flow`, runbook, `docs/IMPLEMENTATION_STATUS.md`.

### Required verification
- Automated browser/API smoke plus real DB integration tests; redacted manual provider smoke when access is available.
- No real secrets, private messages or unlicensed map tiles in test artifacts.

### Acceptance checklist
- Map view, selection and message panel work as an integrated private MVP.
- Limits, rights and data quality are visible and documented.
- Real-time/public features are not falsely marked complete.
- Reviewed PR merged; verification commands/results, migration impact and limitations linked in this issue.

### Explicit non-goals
No public exposure or WebSocket claims.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Existing code to inspect
`docs/API.md`, `docs/POSTGRES.md`, `docs/IMPLEMENTATION_STATUS.md` and completed #13, #22, #23 evidence. Read `AGENTS.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_STATUS.md` and the merged predecessor issue's PR. Paths below are proposed newly created modules unless present on current main.

#### Intended code changes
`tests/e2e/private-map-mvp/`, `docs/MVP_VALIDATION.md`. Keep small feature components; no generic widget may contain aviation policy.

#### Explicit contract
Private smoke scenario identifies one real permitted position and one actual provider message; their observed times, source IDs, bearer, identity match and coverage descriptors are independently observable.

#### Implementation order and error paths
Start migrations with admin then app with restricted runtime credentials, connectors, API and web. Trace a single aircraft end-to-end. Keep live real source content private; screenshots must be redacted or synthetic. Define go/no-go if sources unauthorized.

#### Non-happy-path verification
Real DB+Playwright acceptance, source loss, ambiguous aircraft, no message, missing map tiles, stale position vs recent communication, runtime restart, no public binding.

#### Execution and handoff
1. Confirm predecessor DONE. In this issue's existing status section set IN PROGRESS with UTC date, owner, branch and files; retain original checkboxes.
2. Implement typed inputs and tests, pure rules, feature orchestration, infrastructure adapters and UI last. Preserve source rights and original observation timestamps.
3. Run `npm run check` and applicable real-PostgreSQL/Playwright tests, report actual commands, test counts and CI URL with accurate remote status.
4. Set IN REVIEW with linked PR, record migrations/rollback and residual limitations, check only verified conditions. After merge record SHA, set DONE/close, update EPIC #4 and activate next issue. Never skip a BLOCKED prerequisite.

### Agent implementation blueprint (2026-11-19)

> **Baseline:** `main@373a2755` for Stage2; Stage4 paths depend on preceding merged issues. Proposed file names are implementation guidance and must be reconciled with actual code before writing.

#### Existing/predecessor contracts to inspect
- `docs/ROADMAP.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `docs/API.md`
- `docs/POSTGRES.md`
- `scripts/postgres/run-integration.mjs`
- `apps/web feature contracts merged in #21–#23`

#### File-level ownership and new components
- `tests/e2e/private-map-mvp.spec.ts (or `apps/web/tests/e2e/...` consistent with workspace)`
- `scripts/smoke-private-map.mjs`
- `docs/PRIVATE_MVP_RUNBOOK.md`
- `docs/IMPLEMENTATION_STATUS.md Stage4 verification section`

#### Exact UI/API contracts and invariants
1. The acceptance trace is `real source position → immutable tracking observation → resolved aircraft → selected current position → bbox snapshot → MapLibre marker → detail panel → permitted actual decoded message with source lineage`. Record observation time and ingestion time separately.
2. Provide environment variables for a **private/loopback staging run** and a synthetic fallback. An anonymous browser must not obtain restricted real data from newly added public interfaces; a path segment `/internal` is not proof of authorization.
3. Stage4 is complete only for tested region/provider/capability; list observed latency, area/cost limits, station/protocol coverage and gaps rather than claiming global availability.

#### Implementation order
- **Step 1.** Create a repeatable local/private startup script or documented sequence for PostgreSQL migrations, source connector, position connector, API and frontend; never commit credentials.
- **Step 2.** Test a real permitted aircraft position from #15 through DB and map and a permitted message from #13 through correlation to detail panel; redacted evidence ties IDs to source events.
- **Step 3.** Run negative scenarios: no message, stale ADS-B vs fresh message, ambiguous aircraft, out-of-viewport selection, provider disconnect and message-level-only source.
- **Step 4.** Capture browser screenshots containing synthetic/redacted data, relevant API response examples and measurement window; verify map tile data rights.
- **Step 5.** Record known blockers for public deployment (Stage5 publication authorization, revocations, WS) and only update roadmap Stage4 status when full private E2E is evidenced.

#### Mandatory verification / failure scenarios
- `npm run check`, DB integration suite and web Playwright E2E; no skipped tests masked as PASS.
- A browser smoke from startup to selected aircraft detail with at least one genuine authorized message; negative real-provider tests if granted.
- Prove stale/unknown/partial provider conditions are visible, no sensitive payload leaks into logs/devtools/public endpoints.
- Record observed timing, source licensing, version/commit and data quality in issue.

#### Explicit boundary
Not a public launch; no global coverage guarantees or implied real-time updates, which require Stage5.

#### Issue closure evidence
- Update the original acceptance list plus this work plan; link a merged PR and tested commit, actual commands/results and known data/source restrictions.
- Update the issue status log and EPIC #4 counts and next task only after merge, review and verification; never claim CI passed if it did not run.
- Keep all authored text English and architectural imports compliant with `AGENTS.md`.


---

## 21. [#25] Define source entitlements and versioned publication-policy decisions

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/25  
**Phase:** Stage 5 · Publication and incremental updates  
**Snapshot status:** BACKLOG · **Dependency:** Issue #24 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Parent:** #4 · **Sequence:** 21 · **Stage:** 5 — Publication & realtime · **State:** BACKLOG
> **Strict prerequisite:** #24 must be closed as DONE with a verified merged PR. Do not parallelize.

### Required outcome
Every source field and derived aircraft indicator has an explicit policy decision before public use.

### Exact implementation work
1. Model source licensing/entitlement separately from principal authentication and map visibility; specify `SourceEntitlement`, `VisibilityScope`, `PolicyRevision`, and permitted representation (`summary`, `decoded`, `raw`, `withheld`).
2. Define a pure policy decision with traceable source, field, recipient scope, use and policy version; default to deny when evidence is missing.
3. Document rules for retransmission, raw payloads, station locations, message counts, status colors and downstream derivatives.
4. Define policy errors vs data absence and a source-specific revocation procedure.
5. Use fully synthetic policy fixtures and require rights review for every selected real source.

### Expected ownership / files
`publication/domain` + policy contracts, `docs/PUBLICATION_POLICY.md`, related ADR.

### Verification requirements
- Pure tests for public denied/owner allowed, partial field rights, unknown terms and derived status denied when source denied.
- Architecture checks keep policy independent of HTTP/auth/database.

### Acceptance criteria
- Contract explicitly controls content **and metadata-derived indicators**.
- Unknown entitlement cannot accidentally allow publishing.
- Policy version/source lineage are documented for audit.
- A merged PR, evidence of actual tests and limitations are linked in this issue; epic #4 is updated.

### Out of scope
No grants database or login implementation.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Baseline and files

Inspect AGENTS.md, current roadmap, merged predecessor PR, and these actual or predecessor-created anchors: modules/message-availability/domain/contribution.ts; modules/aircraft-correlation/application/stored-decision.ts. Proposed implementation paths (create if absent): modules/publication/domain/{visibility-scope,source-entitlement,policy-decision}.ts. No shared private-domain imports; keep domain rules independent from HTTP/SQL.

#### Concrete contract

authorizePublication(principal,source,representation,scope,policyRevision) => ALLOW{fields} | DENY{reason}; freshness, counts, station metadata and marker colors require authorization.

#### Algorithm and failure paths

Default deny if rights missing. Test same aircraft with hidden RECENT and visible STALE message; public status stays STALE.

#### Agent handoff and evidence

Before coding confirm predecessor DONE; edit existing issue status log to IN PROGRESS, record branch, UTC time and exact files. First add typed contract and pure unit tests, then ports, adapters and composition. Use actual PostgreSQL tests for SQL changes, browser E2E for UI/WS changes and npm run check for all. Record 401/403/error cases, idempotency, revision checks, rights and source time semantics in PR. If rights are unknown mark BLOCKED rather than substituting fake public data. After review attach merged SHA and pass/fail evidence, check acceptance boxes, mark DONE/close and update EPIC #4; never start successor before this issue closes.

### Agent implementation blueprint (2026-11-19)

> **Stage2 baseline:** `main@373a2755`; later code paths rely on predecessors being merged. All proposed new files must match the actual architecture checker and public entry rules. Full source rights cannot be assumed.

#### Existing code to read
- `docs/architecture/ARCHITECTURE_V2.md §§7–10`
- `packages/backend/src/modules/message-availability/domain/contribution.ts`
- `packages/backend/src/modules/message-availability/infrastructure/contribution-row.ts`
- `packages/backend/src/demo/application/project-decision.ts`

#### Create / extend these small implementation units
- `packages/backend/src/modules/publication/domain/{visibility-scope.ts,source-entitlement.ts,publication-decision.ts,allowed-data-level.ts}`
- `packages/backend/src/modules/publication/application/decide-published-view.ts`
- `packages/backend/src/modules/publication/public/index.ts`
- `packages/backend/tests/publication-policy.test.mjs`
- `docs/PUBLICATION_POLICY.md and `docs/adr/<next>-data-visibility.md``

#### Typed, SQL and security contracts
1. Model `SourceEntitlement` with sourceId, accountScope, permitted fields/dataLevel, use purpose, disclosure audience, validFrom/Until, terms evidence and policyVersion. Missing or expired evidence yields `DENY`, not optimistic public access.
2. Return a discriminated decision: `ALLOW {scope,allowedFields,representation,policyVersion,reason}` or `DENY {code,policyVersion}`. Raw bytes, decoded text, abstracted summary, source/station IDs, coordinates and derived counts/statuses each require independently approved rights.
3. Distinguish authentication capability from data-source redistribution permission. An owner of a feeder is not automatically authorized to publish that feeder's content or precise location.

#### Agent implementation steps
- **Step 1.** Read real Stage3 and Stage4 source-level descriptions, distinguish data the provider supplied from inferred fields, and build a rights matrix in English.
- **Step 2.** Define pure policy models/factories, versioned decision function and field-level redaction plan; avoid importing HTTP, pg, JWT, database or current user.
- **Step 3.** Handle a source with multiple receptions and mixed permissions: public message status/count must depend **only** on permitted evidence, not global dedup/statistics.
- **Step 4.** Introduce policy test fixtures for public visitor vs private station owner vs authorized team; document how to request legal review and revoke grant.
- **Step 5.** Publish small API contracts; avoid `any` generic policy engines and ensure deterministic reason codes for deny/audit.

#### Required unit/integration/security test cases
- Denied source contributes neither decoded content nor message-derived green marker or counts.
- Term expiry, scope mismatch, station precision restriction, mixed public/private observations and missing field rights deny safely.
- Source health and coverage that could reveal hidden activity are also gated.
- Run `npm run check`; no claims that licensing has been legally approved by the code.

#### Ownership and delivery boundary
Pure policy only; #27 persists grants and revisions and #28 builds permitted projections. Existing synthetic `publicEligible` boolean is not an access-control system.

#### Evidence required at review/closure
- Update **this issue** status, original acceptance criteria, tested checklist, PR, merged SHA and migration/rollback evidence.
- Update EPIC #4 only after acceptance; keep one active implementation issue, next issue BACKLOG until predecessor DONE.
- Explicitly distinguish local verified test results from GitHub Actions, and check rights/security before any external publication.


---

## 22. [#26] Implement principal resolution, roles and authenticated API boundaries

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/26  
**Phase:** Stage 5 · Publication and incremental updates  
**Snapshot status:** BACKLOG · **Dependency:** Issue #25 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Parent:** #4 · **Sequence:** 22 · **Stage:** 5 — Publication & realtime · **State:** BACKLOG
> **Strict prerequisite:** #25 must be closed as DONE with a verified merged PR. Do not parallelize.

### Required outcome
Users and feeder services have distinct identities and operation-scoped permissions, with no anonymous access to restricted data.

### Exact implementation work
1. Define `Principal` variants for user, feeder and anonymous; define operation-specific capabilities instead of a global admin Boolean.
2. Validate session/token credentials at HTTP boundaries; use injectable verifier and constant-time secret comparisons where appropriate.
3. Separate feeder upload permission from viewing decoded content or station location; prohibit authorization by user-supplied scope string.
4. Make read/write endpoints explicit about allowed principal capabilities and return safe 401/403 errors.
5. Add revocation/expiry behavior and non-sensitive security audit records; no raw passwords/keys in logs.

### Expected ownership / files
`access` bounded context, credential adapters, API middleware and tests.

### Verification requirements
- No credentials, wrong role, expired/revoked token, feeder trying read, user trying upload, and spoofed scope.
- API integration tests for deny by default; no authorization decision in domain pure rules.

### Acceptance criteria
- All restricted endpoints derive principal identity server-side.
- Invalid credentials and forbidden operations fail closed.
- Token/session behavior is covered by tests and documentation.
- A merged PR, evidence of actual tests and limitations are linked in this issue; epic #4 is updated.

### Out of scope
Not a complete user-facing account-management product; source-specific entitlements are owned by publication.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Baseline and files

Inspect AGENTS.md, current roadmap, merged predecessor PR, and these actual or predecessor-created anchors: apps/api/src/routing/handle-request.ts; apps/api/src/runtime/create-api-runtime.ts. Proposed implementation paths (create if absent): modules/access/domain/{principal,capability}.ts; apps/api/src/auth/. No shared private-domain imports; keep domain rules independent from HTTP/SQL.

#### Concrete contract

Principal = ANONYMOUS | USER | FEEDER; per-operation required capability and server-resolved visibility scope; 401 vs 403.

#### Algorithm and failure paths

Verify expiry/revocation and route matrix, ensure feeder cannot access user view, reject client-provided arbitrary scope, redact credentials.

#### Agent handoff and evidence

Before coding confirm predecessor DONE; edit existing issue status log to IN PROGRESS, record branch, UTC time and exact files. First add typed contract and pure unit tests, then ports, adapters and composition. Use actual PostgreSQL tests for SQL changes, browser E2E for UI/WS changes and npm run check for all. Record 401/403/error cases, idempotency, revision checks, rights and source time semantics in PR. If rights are unknown mark BLOCKED rather than substituting fake public data. After review attach merged SHA and pass/fail evidence, check acceptance boxes, mark DONE/close and update EPIC #4; never start successor before this issue closes.

### Agent implementation blueprint (2026-11-19)

> **Stage2 baseline:** `main@373a2755`; later code paths rely on predecessors being merged. All proposed new files must match the actual architecture checker and public entry rules. Full source rights cannot be assumed.

#### Existing code to read
- `apps/api/src/routing/{route.ts,handle-request.ts}`
- `apps/api/src/http/{http-problem.ts,send-problem.ts,read-json-body.ts}`
- `apps/api/src/runtime/create-api-runtime.ts`
- `docs/architecture/ARCHITECTURE_V2.md publication/access sections`

#### Create / extend these small implementation units
- `packages/backend/src/modules/access/domain/{principal.ts,capability.ts,token-expiry.ts}`
- `packages/backend/src/modules/access/ports/credential-verifier.ts`
- `packages/backend/src/modules/access/application/authorize-capability.ts`
- `apps/api/src/http/{resolve-principal.ts,require-capability.ts}`
- `apps/api/tests/auth-boundaries.test.mjs`
- `docs/AUTHORIZATION.md`

#### Typed, SQL and security contracts
1. Principals are tagged `ANONYMOUS | USER | FEEDER | SERVICE`; source/visibility scopes are determined server-side from verified identity, never a query/body field. Capabilities are operation-specific (`read:map`, `read:message`, `upload:reception`, `manage:station`).
2. Auth parser returns explicit `UNAUTHENTICATED` (HTTP 401), `FORBIDDEN` (403), `EXPIRED`, `REVOKED` results, with no token contents in logs. Allow loopback synthetic demo mode for backward compatibility only under an explicit environment switch.
3. Choose a concrete verifiable token/session mechanism and rotation strategy. The core access domain depends only on a credential verification port; infrastructure handles cryptographic APIs and persistence.

#### Agent implementation steps
- **Step 1.** Document current trust surface and select an authorization integration suitable for Stage5 needs; avoid writing a bespoke password hash/auth server without a concrete reason.
- **Step 2.** Write tagged principal/capability models and a pure `canPerform(principal,operation,resourceScope)` with fail-closed defaults.
- **Step 3.** Create HTTP middleware/adapters that resolve identity once, verify credential expiry/revocation, and pass authorized context into use cases; never accept arbitrary visibility scope from clients.
- **Step 4.** Differentiate feeder uploads from user reads, add auth to endpoints carrying real data and websocket handshake in later #31; preserve memory demo under explicit local config.
- **Step 5.** Add security audit event without raw token, password, decoded message text or station exact position.

#### Required unit/integration/security test cases
- No token, expired token, revoked token, wrong capability, feeder reading messages, user submitting reception, cross-scope spoofed query.
- Safe 401/403 response envelopes, no secret logs, replay of invalid token and token rotation.
- Run existing HTTP tests and new integration cases; regressions for synthetic localhost demo.

#### Ownership and delivery boundary
No publication entitlement logic in auth. #25 and #27 determine whether a particular source field is redistributable.

#### Evidence required at review/closure
- Update **this issue** status, original acceptance criteria, tested checklist, PR, merged SHA and migration/rollback evidence.
- Update EPIC #4 only after acceptance; keep one active implementation issue, next issue BACKLOG until predecessor DONE.
- Explicitly distinguish local verified test results from GitHub Actions, and check rights/security before any external publication.


---

## 23. [#27] Persist visibility scopes, grants and independent publication revisions

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/27  
**Phase:** Stage 5 · Publication and incremental updates  
**Snapshot status:** BACKLOG · **Dependency:** Issue #26 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Parent:** #4 · **Sequence:** 23 · **Stage:** 5 — Publication & realtime · **State:** BACKLOG
> **Strict prerequisite:** #26 must be closed as DONE with a verified merged PR. Do not parallelize.

### Required outcome
Permission changes have a durable, ordered history independent of aircraft-correlation revisions.

### Exact implementation work
1. Add schema for visibility scopes, immutable grant/revocation history, policy revisions and source-to-scope entitlements.
2. Assign an authoritative monotonic contribution/publication revision per `(scope,messageId)`; never compare or take max of unrelated assignment and grant revisions.
3. Implement serialized grant changes with transaction/outbox and idempotent retries; reject equal-revision conflicting payloads.
4. Provide a current policy snapshot/read port that can be checked by API and replay gateway, with a revision/epoch.
5. Add restricted runtime grants, audit metadata and migration checksum tests.

### Expected ownership / files
`publication` migrations, grant use cases, revision writers/readers.

### Verification requirements
- Grant then revoke; simultaneous grant changes; missed events; old revision after revoke; DB rollback.
- Real PostgreSQL role, read/write permission and version-fencing integration tests.

### Acceptance criteria
- Grant histories are immutable and current access can be established unambiguously.
- Independent version domains cannot overwrite each other.
- Revocation is persistently represented before any UI update.
- A merged PR, evidence of actual tests and limitations are linked in this issue; epic #4 is updated.

### Out of scope
Does not yet compute the filtered map projection.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Baseline and files

Inspect AGENTS.md, current roadmap, merged predecessor PR, and these actual or predecessor-created anchors: db/migrations/001_durable_correlation.sql; modules/database-transactions/application/run-sql-transaction.ts. Proposed implementation paths (create if absent): db/migrations/004_publication_grants.sql; modules/publication/infrastructure/postgres/. No shared private-domain imports; keep domain rules independent from HTTP/SQL.

#### Concrete contract

Immutable source entitlements, grant histories and current heads; contributionRevision per (scope,messageId) independent from assignmentRevision and grantRevision.

#### Algorithm and failure paths

Serialize first-write and revisions, commit grant and event atomically, tombstone on revoke. Test concurrent grants, stale event, collision, restricted grants with real PG.

#### Agent handoff and evidence

Before coding confirm predecessor DONE; edit existing issue status log to IN PROGRESS, record branch, UTC time and exact files. First add typed contract and pure unit tests, then ports, adapters and composition. Use actual PostgreSQL tests for SQL changes, browser E2E for UI/WS changes and npm run check for all. Record 401/403/error cases, idempotency, revision checks, rights and source time semantics in PR. If rights are unknown mark BLOCKED rather than substituting fake public data. After review attach merged SHA and pass/fail evidence, check acceptance boxes, mark DONE/close and update EPIC #4; never start successor before this issue closes.

### Agent implementation blueprint (2026-11-19)

> **Stage2 baseline:** `main@373a2755`; later code paths rely on predecessors being merged. All proposed new files must match the actual architecture checker and public entry rules. Full source rights cannot be assumed.

#### Existing code to read
- `db/migrations/001_durable_correlation.sql`
- `packages/backend/src/modules/message-availability/infrastructure/postgres-contribution-writer.ts`
- `packages/backend/src/modules/aircraft-correlation/infrastructure/postgres/lock-message.ts`
- `scripts/postgres/migrate.mjs`

#### Create / extend these small implementation units
- `db/migrations/<next>_publication_grants.sql`
- `packages/backend/src/modules/publication/{application/commit-grant.ts,ports/grant-transaction.ts,infrastructure/postgres/pg-grant-store.ts}`
- `packages/backend/tests/integration/publication-grants.test.mjs`

#### Typed, SQL and security contracts
1. Proposed tables `publication.visibility_scopes`, `publication.entitlement_revisions`, `publication.message_grants`, `publication.policy_epochs` with immutable `(scope,messageId,grantRevision)` history and current heads. Each grant records source rights revision and separate aircraft-assignment revision input.
2. Stage2 `availability.contributions` is keyed solely by `message_id` and revision follows correlation decision. To support distinct public/private scopes, migrate to `(visibility_scope,message_id)` and introduce an authoritative, serialized **contribution revision** per key; do not compare `max(grantRevision,assignmentRevision)`.
3. Revocation creates immutable tombstone/history and changes a scoped policy epoch before public projection can serve old state. Durable grant/outbox update must be one SQL transaction and a source-specific write port.

#### Agent implementation steps
- **Step 1.** Read latest migration number and ownership roles; design upgrade from Stage2 demo rows with an explicit synthetic scope, preserving idempotency and historical contribution state.
- **Step 2.** Add `publication` schema owner NOLOGIN and runtime read/write grants following existing migration conventions; add unique constraints/indexes for scoped history.
- **Step 3.** Implement grant commit using keyed advisory locking or row-level CAS including initial INSERT, immutable revisions and outbox in one transaction.
- **Step 4.** Define authoritative contribution revision allocator for `(scope,messageId)`, with input references to grant, decision and policy; no numeric comparison across independent aggregates.
- **Step 5.** Add migration and concurrency tests (including existing Stage2 data); ensure no grant table can be modified by unrelated HTTP principal.

#### Required unit/integration/security test cases
- Parallel first grant writes only one winner; new grant and revoked grant produce monotonic scoped revisions.
- A grant r1 and aircraft decision r100 must not cause version misuse; old grant event after revocation cannot reopen.
- Outbox failure rollback; migration from existing Stage2 scope; restricted owner/grants and replay integrity.
- `npm run test:postgres:local` and `npm run check`.

#### Ownership and delivery boundary
#28 reads and projects scoped grants, #29 propagates revocations. This issue must preserve Stage2 demo semantics while adding new scope ownership.

#### Evidence required at review/closure
- Update **this issue** status, original acceptance criteria, tested checklist, PR, merged SHA and migration/rollback evidence.
- Update EPIC #4 only after acceptance; keep one active implementation issue, next issue BACKLOG until predecessor DONE.
- Explicitly distinguish local verified test results from GitHub Actions, and check rights/security before any external publication.


---

## 24. [#28] Build privacy-safe, scope-qualified message and map projections

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/28  
**Phase:** Stage 5 · Publication and incremental updates  
**Snapshot status:** BACKLOG · **Dependency:** Issue #27 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Parent:** #4 · **Sequence:** 24 · **Stage:** 5 — Publication & realtime · **State:** BACKLOG
> **Strict prerequisite:** #27 must be closed as DONE with a verified merged PR. Do not parallelize.

### Required outcome
Every visible message, count, timestamp and green/orange status is derived solely from permitted contributions.

### Exact implementation work
1. Resolve current scope from authenticated principal; never accept arbitrary scope from client query parameters.
2. Create scope-qualified permitted message variants that redact excluded text, reception/station metadata and hidden source references.
3. Build per-scope aircraft freshness and counts strictly from permitted contribution ledger, not global latest-message aggregates.
4. Apply filters and pagination only after authorization, avoiding inference through response sizes, timestamps, and errors.
5. Add rebuild/repair mechanism for a changed policy version and a private default while public scope is not approved.

### Expected ownership / files
`publication/application/publish-view`, scope-qualified `read-models` and availability adapter.

### Verification requirements
- Two principals with different grants receive different totals, colors and messages.
- Hidden message must not affect visible lastMessageAt, count, status or cursor; real DB query tests.

### Acceptance criteria
- No hidden message existence can be inferred through display metadata in specified tests.
- Scope filtering is enforced server-side and tested.
- Projection is reproducible from grant and decision history.
- A merged PR, evidence of actual tests and limitations are linked in this issue; epic #4 is updated.

### Out of scope
No websocket or revocation propagation yet.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Baseline and files

Inspect AGENTS.md, current roadmap, merged predecessor PR, and these actual or predecessor-created anchors: demo/application/assemble-aircraft-summary.ts; modules/message-availability/infrastructure/postgres-availability-reader.ts. Proposed implementation paths (create if absent): modules/publication/application/build-permitted-view.ts; modules/read-models/scope-map/. No shared private-domain imports; keep domain rules independent from HTTP/SQL.

#### Concrete contract

Projection key (visibilityScope,aircraftId); aggregate lastMessageAt/count/freshness solely from ALLOWED contributions, not global records.

#### Algorithm and failure paths

Apply filter before aggregation and cursor generation. Two principals with different rights must get different status and counts, without leakage.

#### Agent handoff and evidence

Before coding confirm predecessor DONE; edit existing issue status log to IN PROGRESS, record branch, UTC time and exact files. First add typed contract and pure unit tests, then ports, adapters and composition. Use actual PostgreSQL tests for SQL changes, browser E2E for UI/WS changes and npm run check for all. Record 401/403/error cases, idempotency, revision checks, rights and source time semantics in PR. If rights are unknown mark BLOCKED rather than substituting fake public data. After review attach merged SHA and pass/fail evidence, check acceptance boxes, mark DONE/close and update EPIC #4; never start successor before this issue closes.

### Agent implementation blueprint (2026-11-19)

> **Stage2 baseline:** `main@373a2755`; later code paths rely on predecessors being merged. All proposed new files must match the actual architecture checker and public entry rules. Full source rights cannot be assumed.

#### Existing code to read
- `packages/backend/src/modules/message-availability/infrastructure/{postgres-availability-reader.ts,postgres-contribution-writer.ts}`
- `packages/backend/src/demo/application/{project-decision.ts,assemble-aircraft-summary.ts}`
- `packages/backend/src/demo/public/types.ts`
- `Stage4 #20 map snapshot and Stage5 #27 grant storage`

#### Create / extend these small implementation units
- `packages/backend/src/modules/publication/application/{select-visible-fields.ts,project-visibility-scope.ts}`
- `packages/backend/src/modules/read-models/application/{build-scoped-map-view.ts,build-scoped-message-timeline.ts}`
- `packages/backend/src/modules/read-models/infrastructure/postgres/{scope-map-reader.ts,scope-message-reader.ts}`
- `packages/backend/tests/integration/scoped-publication.test.mjs`

#### Typed, SQL and security contracts
1. `PublishedMessageView` is tagged by `representation:'WITHHELD'|'SUMMARY'|'DECODED'|'RAW'`, with strictly limited keys; a message hidden from the scope must **not appear** as a withheld row if its very existence is restricted.
2. `ScopedAircraftMapRow {scope,aircraftId,position,allowedFreshness,allowedLastMessageAt,allowedMessageCount,coverage,feedHealth,projectionRevision}` derives every communication field strictly from allowed contributions.
3. Never query global `max(observed_at_ms)` for a public status when a private message is newer. The existing `postgres-availability-reader.ts` is global and must be replaced/wrapped by scope-constrained projection access for real data.

#### Agent implementation steps
- **Step 1.** Design a pure field-selector from #25 policy decisions that strips forbidden source/station/receiver refs, raw text, message IDs and derived metadata consistently.
- **Step 2.** Add materialized or query-time scoped projections using `(scope,messageId)` contributions and per-scope rows. Use one stable authorization context passed through the read contract.
- **Step 3.** Perform permission filtering **before** aggregate count/timestamp/freshness computation, keyset cursor construction and caching. Cache keys include scope+policyEpoch and filter.
- **Step 4.** Provide a projection rebuild/repair path for changed grants and match links; retain existing demo endpoints but do not leak real content via them.
- **Step 5.** Add API serializers with fixed schemas and negative tests where source data exists but must appear absent to an unauthorized principal.

#### Required unit/integration/security test cases
- Private source message and shared public position: public lastMessageAt/color/count must remain unaffected.
- One public and one private reception of identical text: only public provenance disclosed; station and raw reference withheld.
- Scope A cursor reused in scope B fails; unauthorized direct message ID read fails; policy epoch invalidation works.
- Real SQL tests for scoped aggregation and concurrent A→B correction.

#### Ownership and delivery boundary
This issue builds scope-aware read models, not a WebSocket. #29 handles revocation barriers; #30 stores ordered deltas.

#### Evidence required at review/closure
- Update **this issue** status, original acceptance criteria, tested checklist, PR, merged SHA and migration/rollback evidence.
- Update EPIC #4 only after acceptance; keep one active implementation issue, next issue BACKLOG until predecessor DONE.
- Explicitly distinguish local verified test results from GitHub Actions, and check rights/security before any external publication.


---

## 25. [#29] Propagate permission revocations as contribution tombstones and removals

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/29  
**Phase:** Stage 5 · Publication and incremental updates  
**Snapshot status:** BACKLOG · **Dependency:** Issue #28 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Parent:** #4 · **Sequence:** 25 · **Stage:** 5 — Publication & realtime · **State:** BACKLOG
> **Strict prerequisite:** #28 must be closed as DONE with a verified merged PR. Do not parallelize.

### Required outcome
After a revoked grant, public projections and future deliveries converge to a view without the excluded data.

### Exact implementation work
1. On grant revocation, atomically commit a new scope/policy epoch and a durable event with authoritative revision.
2. Replace or retract affected contributions with tombstones; recalculate old/new aircraft states, preserving fallback to other eligible messages.
3. Invalidate server-side caches and replay scopes, and generate versioned removals for affected projected objects.
4. Place a final current-policy gate on reads and replay so asynchronous projections cannot keep serving revoked content.
5. Document what cannot be undone after client already received data and test no further delivery.

### Expected ownership / files
`publication/application/revoke`, `availability` contribution writer, change emission.

### Verification requirements
- Revocation before and after snapshot; delayed old contribution; A→B correction interleaving; worker crash mid-retract.
- Unauthorized reads and retries never restore content, status, count or hidden station references.

### Acceptance criteria
- Revoked content cannot be read after the authoritative revocation commits.
- Tombstones fence out stale events and projection repairs converge.
- Security tests verify no future leakage.
- A merged PR, evidence of actual tests and limitations are linked in this issue; epic #4 is updated.

### Out of scope
No WebSocket protocol implementation; define removal events for later stage.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Baseline and files

Inspect AGENTS.md, current roadmap, merged predecessor PR, and these actual or predecessor-created anchors: modules/message-availability/infrastructure/postgres-contribution-writer.ts; modules/event-delivery/infrastructure/consume-event.ts. Proposed implementation paths (create if absent): modules/publication/application/revoke-publication.ts; modules/read-models/retraction-projection/. No shared private-domain imports; keep domain rules independent from HTTP/SQL.

#### Concrete contract

Revoke advances policy epoch + contribution revision; tombstone cannot be undone by old assignment event.

#### Algorithm and failure paths

Commit revoke/outbox atomically; consumer retracts and recomputes fallback, gateway checks current epoch. Test revoked data not reappearing on retry or reconnect.

#### Agent handoff and evidence

Before coding confirm predecessor DONE; edit existing issue status log to IN PROGRESS, record branch, UTC time and exact files. First add typed contract and pure unit tests, then ports, adapters and composition. Use actual PostgreSQL tests for SQL changes, browser E2E for UI/WS changes and npm run check for all. Record 401/403/error cases, idempotency, revision checks, rights and source time semantics in PR. If rights are unknown mark BLOCKED rather than substituting fake public data. After review attach merged SHA and pass/fail evidence, check acceptance boxes, mark DONE/close and update EPIC #4; never start successor before this issue closes.

### Agent implementation blueprint (2026-11-19)

> **Baseline:** Stage2 `main@373a2755`; future files from dependent issues are not yet present. Confirm actual paths and signed data rights before implementing. Pure domain rules cannot depend on transport/database.

#### Existing inputs / contracts to inspect
- `packages/backend/src/modules/message-availability/domain/{apply-contribution-change.ts,contribution-ledger.ts}`
- `packages/backend/src/modules/message-availability/infrastructure/postgres-contribution-writer.ts`
- `Stage5 #27 grant revisions and #28 scope-qualified projections`
- `docs/architecture/ARCHITECTURE_V2.md §8`

#### Proposed file-level plan
- `packages/backend/src/modules/publication/application/{revoke-message-grant.ts,plan-retraction.ts}`
- `packages/backend/src/modules/publication/ports/publication-revocation-transaction.ts`
- `packages/backend/src/modules/read-models/application/invalidate-scope-epoch.ts`
- `packages/backend/tests/integration/revocation-convergence.test.mjs`
- `docs/PUBLICATION_POLICY.md revocation runbook`

#### Concrete wire, SQL and security invariants
1. Authoritative revocation is a transaction that commits a new `(scope,messageId)` grant revision and policy epoch. After it commits, a **final read/replay permission gate** rejects old content even before asynchronous projection catches up.
2. Retraction event carries new `contributionRevision` independent of aircraft-decision/visibility-grant version, and a tombstone (`RETRACTED`) for old contribution. It must recompute affected aircraft/status/count and restore older *eligible* messages.
3. WebSocket later needs `remove`, `replace` or `resync.required` with scope policy epoch. Do not pretend sending a client-side remove can erase data already legitimately delivered.

#### Agent implementation checklist
- **Step 1.** Implement a single revoke use case with an idempotency key, expected grant revision and audited cause; write history/outbox and updated scope policy epoch atomically.
- **Step 2.** Add versioned retract/tombstone transformer to existing availability writer for `(scope,messageId)` and ensure A→B prior/current targets are recalculated consistently.
- **Step 3.** Enforce current policy at HTTP reads independently of materialized view freshness; invalidate server caches keyed by old epoch.
- **Step 4.** Emit scoped removal changes for any affected message, count/status and map marker, then replay/reconcile from authoritative grants after crashes.
- **Step 5.** Document revocation completion definition (`authoritative gate effective` vs `projections converged`), and provide operator repair command protected from unscoped use.

#### Mandatory verification scenarios
- Revoke while old delivery still queued; old event must not resurrect tombstone.
- Grant denied at final read before projector catches up; no message or color/count leakage.
- Revocation intersecting A→B decision and a concurrent expiry, transactional rollback and restart recovery.
- Public old cursor/token cannot resume against new policy epoch.

#### Boundary and next-task handoff
#30 adds ordered change log and #31 WS barrier; do not implement a fake client-notification solution without the server-side gate.

#### Definition of DONE evidence
- Complete existing acceptance criteria, record PR/merged SHA, actual unit/SQL/browser commands and results, migration/rollback and policy rights evidence.
- Update this issue body state and EPIC #4 progress. Leave next issue BACKLOG until this one is merged and verified.
- Do not report non-running GitHub Actions as successful, and do not leak real-source fields before authorizing them.


---

## 26. [#30] Persist an ordered map snapshot checkpoint and incremental change log

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/30  
**Phase:** Stage 5 · Publication and incremental updates  
**Snapshot status:** BACKLOG · **Dependency:** Issue #29 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Parent:** #4 · **Sequence:** 26 · **Stage:** 5 — Publication & realtime · **State:** BACKLOG
> **Strict prerequisite:** #29 must be closed as DONE with a verified merged PR. Do not parallelize.

### Required outcome
Snapshot and subsequent `upsert/remove` deltas share one projection generation and a gap-free commit order.

### Exact implementation work
1. Introduce per-scope/per-shard projection generation, locked stream-head revision, map rows and append-only change log.
2. In the same transaction, update view rows, allocate a serialized revision and append an immutable delta record; do not use an uncommitted SQL sequence as checkpoint.
3. Implement consistent snapshot reads (rows + checkpoint from the same DB view) and replay after checkpoint.
4. Define `upsert`, `remove`, `replace` and `resync.required` semantics with bounded retention and opaque cursor contract.
5. Handle leaving bbox/filter matches and generation changes; no global event IDs exposed in client cursors.

### Expected ownership / files
`read-models/map-change-log`, DB migrations and read-model projection writer.

### Verification requirements
- Concurrent writers, slow snapshot reader, out-of-order allocations, remove/viewport exit, retention expiry and rebuild.
- Real PostgreSQL concurrency tests prove no committed change is lost in snapshot→replay.

### Acceptance criteria
- A snapshot checkpoint cannot conceal a later-committing lower revision.
- Client can replay every authorized change since a retained checkpoint.
- Database constraints and indexes support bounded scans.
- A merged PR, evidence of actual tests and limitations are linked in this issue; epic #4 is updated.

### Out of scope
No WebSocket transport or client reducer.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Baseline and files

Inspect AGENTS.md, current roadmap, merged predecessor PR, and these actual or predecessor-created anchors: modules/event-delivery/infrastructure/fan-out.ts; db/migrations/001_durable_correlation.sql. Proposed implementation paths (create if absent): modules/read-models/map-change-log/; db/migrations/005_map_stream.sql. No shared private-domain imports; keep domain rules independent from HTTP/SQL.

#### Concrete contract

Snapshot {generation,checkpoint,rows} and ordered log {scope,shard,generation,revision,upserts,removes}. DB row-lock stream head establishes commit order.

#### Algorithm and failure paths

Write map row and changelog in same transaction, never checkpoint via unconstrained SQL SEQUENCE. Race concurrent writes/snapshot and prove gap-free replay.

#### Agent handoff and evidence

Before coding confirm predecessor DONE; edit existing issue status log to IN PROGRESS, record branch, UTC time and exact files. First add typed contract and pure unit tests, then ports, adapters and composition. Use actual PostgreSQL tests for SQL changes, browser E2E for UI/WS changes and npm run check for all. Record 401/403/error cases, idempotency, revision checks, rights and source time semantics in PR. If rights are unknown mark BLOCKED rather than substituting fake public data. After review attach merged SHA and pass/fail evidence, check acceptance boxes, mark DONE/close and update EPIC #4; never start successor before this issue closes.

### Agent implementation blueprint (2026-11-19)

> **Baseline:** Stage2 `main@373a2755`; future files from dependent issues are not yet present. Confirm actual paths and signed data rights before implementing. Pure domain rules cannot depend on transport/database.

#### Existing inputs / contracts to inspect
- `Stage4 #20 map projection and API snapshot`
- `packages/backend/src/modules/database-transactions/application/run-sql-transaction.ts`
- `scripts/postgres/migrate.mjs`
- `docs/architecture/ARCHITECTURE_V2.md §10`

#### Proposed file-level plan
- `db/migrations/<next>_map_change_log.sql`
- `packages/backend/src/modules/read-models/{domain/map-change.ts,application/commit-map-delta.ts,ports/map-snapshot-reader.ts}`
- `packages/backend/src/modules/read-models/infrastructure/postgres/{map-change-writer.ts,map-snapshot-reader.ts,map-replay-reader.ts}`
- `packages/backend/tests/integration/map-snapshot-replay.test.mjs`

#### Concrete wire, SQL and security invariants
1. Schema draft: `map_read.generation(scope,shard,generationId)`, `map_read.stream_heads(scope,shard,generation,revision)`, `map_read.rows(scope,aircraftId,version,view)`, `map_read.change_log(scope,shard,generation,revision,changeSet,recordedAt)`. Define max delta batch, TTL and cursor generation explicitly.
2. Commit rows + a change log entry + serialized head revision **in one transaction**. Use a locked stream-head row or equivalent commit-order sequencer, *not* `nextval(sequence)` or `MAX(outbox.id)` as consistent snapshot checkpoint.
3. Snapshot read uses the same MVCC view for `cursor=C` and row set. Replay returns log entries with revision greater than C up to current; gap/expired retention triggers `RESYNC_REQUIRED` rather than skipping.

#### Agent implementation checklist
- **Step 1.** Write precise snapshot/delta DTOs and internal cursor object `(scope,filterFingerprint,policyEpoch,projectionGeneration,shardRevision)`; expose only signed/opaque token to clients.
- **Step 2.** Add migration with owner and indexes for scope/generation/sequence and bbox membership; preserve existing Stage4 snapshot behavior.
- **Step 3.** Implement projection writer to lock head row, update map rows, append `upsert/remove` changeSet, increment revision; rollback all if any step fails.
- **Step 4.** Implement consistent snapshot reader and bounded replay query using REPEATABLE READ or single transaction snapshot; cover update between snapshot and live registration.
- **Step 5.** Define projection generation rebuild, retention and explicit remove when aircraft leaves bbox or becomes inaccessible.

#### Mandatory verification scenarios
- Two SQL writers allocate overlapping revisions: no checkpoint can conceal a later-committing older event.
- Snapshot begins, concurrent new event commits, replay returns exactly one semantically applied delta.
- Retained/expired cursor, changed scope/filters, aircraft leaves bbox and policy revocation produces remove.
- Real PostgreSQL transaction/index tests and file-level architecture boundaries.

#### Boundary and next-task handoff
This issue produces durable projection changelog, not WebSocket transport. #31 implements snapshot/replay delivery.

#### Definition of DONE evidence
- Complete existing acceptance criteria, record PR/merged SHA, actual unit/SQL/browser commands and results, migration/rollback and policy rights evidence.
- Update this issue body state and EPIC #4 progress. Leave next issue BACKLOG until this one is merged and verified.
- Do not report non-running GitHub Actions as successful, and do not leak real-source fields before authorizing them.


---

## 27. [#31] Implement authorized WebSocket subscriptions with snapshot/replay barrier

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/31  
**Phase:** Stage 5 · Publication and incremental updates  
**Snapshot status:** BACKLOG · **Dependency:** Issue #30 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Parent:** #4 · **Sequence:** 27 · **Stage:** 5 — Publication & realtime · **State:** BACKLOG
> **Strict prerequisite:** #30 must be closed as DONE with a verified merged PR. Do not parallelize.

### Required outcome
A live client receives the same scope-approved map state as REST, then continuous ordered updates without a race gap.

### Exact implementation work
1. Authenticate and authorize each subscription for server-derived visibility scope, filters, bbox and resource budgets.
2. Register/buffer updates before reading a consistent projection snapshot; send `snapshot.begin`, rows, `snapshot.end(cursor,generation)` then replay changes since its checkpoint.
3. Use scope/policy-bound opaque resume tokens; reject expired, revoked or mismatched generation/filter tokens with `resync.required`.
4. Bound per-client buffers and subscription counts; coalesce positions when safe, while loss of message events requires resync.
5. On revocation close/invalidate affected streams and stop future unauthorized updates; implement graceful shutdown.

### Expected ownership / files
`delivery/realtime-gateway`, authenticated WS transport, subscription ports.

### Verification requirements
- Gap at subscribe boundary, rapid resubscribe/filter change, slow consumer, disconnect/reconnect and scope revocation.
- Protocol contract and end-to-end tests with real snapshot/replay data.

### Acceptance criteria
- No event lost during snapshot/live handoff under tested concurrency.
- No unauthorized payload/cursor replay after revocation.
- Backpressure, retention and errors are explicit.
- A merged PR, evidence of actual tests and limitations are linked in this issue; epic #4 is updated.

### Out of scope
The frontend applying the WS protocol is a separate task.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Baseline and files

Inspect AGENTS.md, current roadmap, merged predecessor PR, and these actual or predecessor-created anchors: apps/api/src/runtime/shutdown.ts; modules/event-delivery/ports/; new map stream from #30. Proposed implementation paths (create if absent): modules/delivery/realtime-gateway/; apps/api/src/ws/. No shared private-domain imports; keep domain rules independent from HTTP/SQL.

#### Concrete contract

subscribe.viewport includes bbox/filter and server-derived principal scope; snapshot.begin/rows/snapshot.end(cursor,generation), then replay and live deltas.

#### Algorithm and failure paths

Buffer before consistent snapshot; opaque token tied to scope+epoch+filter+generation; cap queue, auth on replay, resync after retention/rights change.

#### Agent handoff and evidence

Before coding confirm predecessor DONE; edit existing issue status log to IN PROGRESS, record branch, UTC time and exact files. First add typed contract and pure unit tests, then ports, adapters and composition. Use actual PostgreSQL tests for SQL changes, browser E2E for UI/WS changes and npm run check for all. Record 401/403/error cases, idempotency, revision checks, rights and source time semantics in PR. If rights are unknown mark BLOCKED rather than substituting fake public data. After review attach merged SHA and pass/fail evidence, check acceptance boxes, mark DONE/close and update EPIC #4; never start successor before this issue closes.

### Agent implementation blueprint (2026-11-19)

> **Baseline:** Stage2 `main@373a2755`; future files from dependent issues are not yet present. Confirm actual paths and signed data rights before implementing. Pure domain rules cannot depend on transport/database.

#### Existing inputs / contracts to inspect
- `apps/api/src/{create-api-server.ts,runtime/shutdown.ts,routing/handle-request.ts}`
- `Stage5 #26 principal/auth capabilities`
- `Stage5 #28 scope-qualified readers and #30 snapshot/replay checkpoints`
- `packages/backend/src/modules/event-delivery/ports/delivery-queue.ts`

#### Proposed file-level plan
- `packages/backend/src/modules/delivery/{domain/subscription.ts,application/create-snapshot-stream.ts,ports/change-feed.ts}`
- `apps/api/src/realtime/{upgrade-auth.ts,subscription-router.ts,connection-lifecycle.ts}`
- `apps/api/tests/integration/realtime-snapshot.test.mjs`
- `docs/REALTIME_PROTOCOL.md`

#### Concrete wire, SQL and security invariants
1. Client `subscribe.viewport` `{requestId,bbox,filters,resumeToken?}`; server derives principal and scope and returns `{subscriptionId,generation,cursor,filterFingerprint,policyEpoch}`. Initial stream is `snapshot.begin → rows → snapshot.end(cursor) → delta.batch*`.
2. Register/buffer change feed **before** reading versioned snapshot, send snapshot at a consistent checkpoint then replay only changes `> C`. A missing checkpoint, revoked epoch, stale generation or incompatible filter requires `resync.required`.
3. Queue buffers and subscriptions per connection are bounded; coalesce redundant position upserts if safe but never silently drop unique message effects. Slow client receives explicit overflow/resync and bounded disconnect.

#### Agent implementation checklist
- **Step 1.** Choose supported WS library/protocol with pinned dependency and document exact Origin/TLS/auth requirements; authenticate upgrade and each subscription using #26 and #25 policy.
- **Step 2.** Write pure validated subscription/filter parser; reject invalid bbox/cursor, too many subscriptions and arbitrary scope parameter.
- **Step 3.** Implement a snapshot barrier orchestrator using #30 consistent snapshot+change log; queue revisions/generations and feed only scoped changes; no direct SQL from socket handlers.
- **Step 4.** Implement per-connection lifecycle (heartbeat, reconnect semantics, shutdown cleanup) and final policyEpoch gate on replay/send.
- **Step 5.** Document wire error variants, backpressure max sizes, retention/resume constraints, client ACK/no-ACK behavior and ordering guarantees.

#### Mandatory verification scenarios
- Artificial event between `snapshot.begin` and `snapshot.end` must be replayed; no missed delta.
- Policy revoked during snapshot or resume: old token rejected and no more payload delivered.
- Slow client, malformed websocket request, two subscriptions with different filters, expired cursor and disconnect/clean shutdown.
- Real DB+WS E2E with `upsert` and `remove`, no hidden data in protocol.

#### Boundary and next-task handoff
Do not implement React delta state logic here; #32 is client code. Do not let an authenticated principal override its own visibility scope.

#### Definition of DONE evidence
- Complete existing acceptance criteria, record PR/merged SHA, actual unit/SQL/browser commands and results, migration/rollback and policy rights evidence.
- Update this issue body state and EPIC #4 progress. Leave next issue BACKLOG until this one is merged and verified.
- Do not report non-running GitHub Actions as successful, and do not leak real-source fields before authorizing them.


---

## 28. [#32] Implement client snapshot/delta reducer and reconnect lifecycle

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/32  
**Phase:** Stage 5 · Publication and incremental updates  
**Snapshot status:** BACKLOG · **Dependency:** Issue #31 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Parent:** #4 · **Sequence:** 28 · **Stage:** 5 — Publication & realtime · **State:** BACKLOG
> **Strict prerequisite:** #31 must be closed as DONE with a verified merged PR. Do not parallelize.

### Required outcome
The React map and message panel stay synchronized with the server and recover safely from stale streams.

### Exact implementation work
1. Model state by subscriptionId, generation, opaque cursor, per-record revision and server-derived scope fingerprint.
2. Apply snapshot only after end marker; ignore out-of-generation or older deltas, and process `upsert/remove/replace` deterministically.
3. Reconnect with a bounded exponential backoff and resume cursor; on resync request a new snapshot instead of guessing missing events.
4. On viewport/filter change, cancel the old subscription and generation, remove stale markers and preserve selected aircraft in URL.
5. Update accessible freshness/coverage labels and loading/offline feedback independent of marker color.

### Expected ownership / files
`apps/web/features/realtime-session` and pure `map-delta-reducer`.

### Verification requirements
- Unit tests for duplicate/out-of-order/missing deltas, delayed previous-generation updates and removes.
- Playwright simulated disconnect, changes of bbox/filter and forced resync without duplicate markers.

### Acceptance criteria
- Repeated reconnect converges to the correct server view.
- No stale selection or ghost markers due to old generation.
- Client does not rely on global event ordering.
- A merged PR, evidence of actual tests and limitations are linked in this issue; epic #4 is updated.

### Out of scope
No new message decoding logic.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Baseline and files

Inspect AGENTS.md, current roadmap, merged predecessor PR, and these actual or predecessor-created anchors: apps/web map features from #22 and status panel from #23. Proposed implementation paths (create if absent): apps/web/src/features/realtime-session/{client,delta-reducer,reconnect}.ts. No shared private-domain imports; keep domain rules independent from HTTP/SQL.

#### Concrete contract

Reducer validates subscriptionId,generation,cursor,rowRevision; kinds upsert/remove/replace/resync.required; client keeps latest accepted projection.

#### Algorithm and failure paths

Implement pure reducer before WS hook, reconnect via bounded retry and snapshot on invalid token; tests for delayed old generation, ghost markers and viewport shift.

#### Agent handoff and evidence

Before coding confirm predecessor DONE; edit existing issue status log to IN PROGRESS, record branch, UTC time and exact files. First add typed contract and pure unit tests, then ports, adapters and composition. Use actual PostgreSQL tests for SQL changes, browser E2E for UI/WS changes and npm run check for all. Record 401/403/error cases, idempotency, revision checks, rights and source time semantics in PR. If rights are unknown mark BLOCKED rather than substituting fake public data. After review attach merged SHA and pass/fail evidence, check acceptance boxes, mark DONE/close and update EPIC #4; never start successor before this issue closes.

### Agent implementation blueprint (2026-11-19)

> **Baseline:** Stage2 `main@373a2755`; future files from dependent issues are not yet present. Confirm actual paths and signed data rights before implementing. Pure domain rules cannot depend on transport/database.

#### Existing inputs / contracts to inspect
- `apps/web map and detail features from #22–#23`
- `apps/web typed API client and URL state from #21`
- `Stage5 #31 `docs/REALTIME_PROTOCOL.md``

#### Proposed file-level plan
- `apps/web/src/features/realtime-session/{connection.ts,useRealtimeSession.ts,subscription-state.ts,apply-map-delta.ts,resume-token.ts}`
- `apps/web/tests/realtime-reducer.test.ts`
- `apps/web/tests/realtime-reconnect.spec.ts`

#### Concrete wire, SQL and security invariants
1. Reducer state: `{subscriptionId,generation,cursor,policyEpoch,filterFingerprint,rows:Map<AircraftId,MapRow>}`. `applyMapDelta(state,batch)` returns a new state only if subscription/generation and monotonic cursor/revision match.
2. A snapshot is staged until `snapshot.end`; incomplete snapshot after socket loss is discarded and rebuilt. `remove` deletes marker while preserving selected aircraft in URL with an `out of viewport` reason.
3. Resume token is opaque and scope-bound, not parsed for authorization in JS. On `resync.required`, scope change or expired cursor, clear derived cache and request full authorized snapshot.

#### Agent implementation checklist
- **Step 1.** Implement pure reducer that atomically handles `upsert`, `remove`, `replace`, duplicate event, skipped revision and policy change; no MapLibre calls inside reducer.
- **Step 2.** Add connection state machine (`DISCONNECTED`, `CONNECTING`, `SNAPSHOTTING`, `LIVE`, `RESYNCING`) and bounded exponential reconnect with cleanup on unmount.
- **Step 3.** Integrate live view state into map markers, list, counts and details without creating a second unrelated aircraft collection.
- **Step 4.** On filter/viewport URL update, increment generation locally, terminate old subscription, ignore delayed previous updates, issue new subscribe.
- **Step 5.** Show accessible offline/reconnecting status and last observation times, preserving selection when marker leaves viewport.

#### Mandatory verification scenarios
- Apply same delta twice (idempotent); older generation event ignored; missing revision forces resync.
- Disconnect during partial snapshot, reconnect/expired cursor, permission revoked and rapid filter toggles.
- Playwright live fake server test: no duplicate markers or ghost aircraft; selected ID survives viewport removal.
- Frontend build, types, root boundaries and wire contract tests.

#### Boundary and next-task handoff
Client never decides publication permissions. A green dot reflects server-scoped data; this is not a source-health badge.

#### Definition of DONE evidence
- Complete existing acceptance criteria, record PR/merged SHA, actual unit/SQL/browser commands and results, migration/rollback and policy rights evidence.
- Update this issue body state and EPIC #4 progress. Leave next issue BACKLOG until this one is merged and verified.
- Do not report non-running GitHub Actions as successful, and do not leak real-source fields before authorizing them.


---

## 29. [#33] Verify publication safety and realtime reliability end to end

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/33  
**Phase:** Stage 5 · Publication and incremental updates  
**Snapshot status:** BACKLOG · **Dependency:** Issue #32 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Parent:** #4 · **Sequence:** 29 · **Stage:** 5 — Publication & realtime · **State:** BACKLOG
> **Strict prerequisite:** #32 must be closed as DONE with a verified merged PR. Do not parallelize.

### Required outcome
Stage5 completes only after a private and a permitted public principal are proven to see exactly their allowed data through REST and WS.

### Exact implementation work
1. Test two principals/scopes with deliberately overlapping public and private message provenance.
2. Exercise anonymous access, grant changes, revocation during stream, backfill, and status/count recomputation.
3. Reproduce race between snapshot checkpoint and new event, cursor expiry, slow client, crash and reconnection.
4. Capture bounded latency/throughput observations and explain operational limitations without promising scale.
5. Update Stage5 roadmap status only after security and recovery gates are evidenced.

### Expected ownership / files
`tests/e2e/publication-realtime`, threat-case fixtures and `docs/IMPLEMENTATION_STATUS.md`.

### Verification requirements
- Real DB + API + WS + browser E2E suite; unauthorized content absent from payloads, counts, colors and resumption.
- CI artifact with redacted results, reproducible commands and linked release decision.

### Acceptance criteria
- No unauthorized content or metadata leak across tested paths.
- Snapshot/replay gap and revocation behavior are demonstrated.
- A documented go/no-go decision approves only the actual permitted scope.
- A merged PR, evidence of actual tests and limitations are linked in this issue; epic #4 is updated.

### Out of scope
No advanced flight/session/reassembly requirements from Stage6.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Baseline and files

Inspect AGENTS.md, current roadmap, merged predecessor PR, and these actual or predecessor-created anchors: docs/API.md; #25-#32 source PRs, apps/api WebSocket and apps/web. Proposed implementation paths (create if absent): tests/e2e/publication-realtime/; docs/REALTIME_VALIDATION.md. No shared private-domain imports; keep domain rules independent from HTTP/SQL.

#### Concrete contract

Acceptance transcript with public and private principal, permitted and denied messages, serialized map snapshot/checkpoint and actual delta stream.

#### Algorithm and failure paths

Exercise revoke mid-snapshot, replay after policy epoch, hidden data in counts/colors/lastMessageAt, stream disconnect. No PASS without actual DB+WS+browser tests.

#### Agent handoff and evidence

Before coding confirm predecessor DONE; edit existing issue status log to IN PROGRESS, record branch, UTC time and exact files. First add typed contract and pure unit tests, then ports, adapters and composition. Use actual PostgreSQL tests for SQL changes, browser E2E for UI/WS changes and npm run check for all. Record 401/403/error cases, idempotency, revision checks, rights and source time semantics in PR. If rights are unknown mark BLOCKED rather than substituting fake public data. After review attach merged SHA and pass/fail evidence, check acceptance boxes, mark DONE/close and update EPIC #4; never start successor before this issue closes.

### Agent implementation blueprint (2026-11-19)

> **Baseline:** Stage2 `main@373a2755`; future files from dependent issues are not yet present. Confirm actual paths and signed data rights before implementing. Pure domain rules cannot depend on transport/database.

#### Existing inputs / contracts to inspect
- `Stage5 #25–#32 merged policy/auth/projections/ws/frontend contracts`
- `docs/ROADMAP.md and docs/IMPLEMENTATION_STATUS.md`
- `scripts/postgres/run-integration.mjs`
- `frontend Playwright E2E and internal map API`

#### Proposed file-level plan
- `tests/e2e/publication-and-realtime.spec.ts`
- `tests/fixtures/security/scoped-message-data.ts (purely synthetic)`
- `docs/REALTIME_ACCEPTANCE.md`
- `docs/IMPLEMENTATION_STATUS.md Stage5 evidence`

#### Concrete wire, SQL and security invariants
1. Test fixture: two principals P_public/P_owner; two observations with same decoded text but different authorized source/reception scopes. Public stream, counts, colors and timelines may depend **only** on eligible public contributions.
2. Delivery must satisfy `snapshot.begin/snapshot.end + replay after checkpoint + live ordered delta`; test at least one event committed exactly during snapshot; no silent gap or duplication of effective state.
3. Revocation barrier: after grant epoch commit public reads/replay must fail closed even if async projector is delayed; old resume token invalid. A disconnected WS must not continue serving retained private payload.

#### Agent implementation checklist
- **Step 1.** Start ephemeral real PostgreSQL and API/WS/frontend harness with synthetic granted/private observations and map positions; bind only to localhost/private test host.
- **Step 2.** Exercise positive owner flow and public limited flow through REST, WebSocket, and browser map; capture exact response fields and status/count provenance.
- **Step 3.** Force grant revocation during snapshot/reconnect, projection delay, cursor expiry and viewport removal, verifying no hidden message, metadata or status signal appears.
- **Step 4.** Test resource budgets with a slow client and malformed subscription; capture detection and resync behavior instead of unbounded buffers.
- **Step 5.** Record test IDs, commit SHA, actual source-policy decision, latency envelope and known limits. Update Stage5 status only after all security gates pass.

#### Mandatory verification scenarios
- Real DB transaction + WS/browser E2E across two scopes and parallel event writes.
- Read a hidden message by guessing its ID, counting objects, old cursors or station metadata: no disclosure.
- Crash after accepted message, before publish; restart and converge from inbox/outbox; no phantom green status.
- Run full `npm run check`, PostgreSQL and browser tests, and distinguish remote CI block from test failures.

#### Boundary and next-task handoff
This is a release checkpoint for publication/realtime, not permission to run public real feeds without Stage6/production readiness gates.

#### Definition of DONE evidence
- Complete existing acceptance criteria, record PR/merged SHA, actual unit/SQL/browser commands and results, migration/rollback and policy rights evidence.
- Update this issue body state and EPIC #4 progress. Leave next issue BACKLOG until this one is merged and verified.
- Do not report non-running GitHub Actions as successful, and do not leak real-source fields before authorizing them.


---

## 30. [#34] Model versioned flight sessions and uncertain flight boundaries

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/34  
**Phase:** Stage 6 · Advanced domains  
**Snapshot status:** BACKLOG · **Dependency:** Issue #33 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 30 · **Stage:** 6 — Advanced aviation domains · **Status:** BACKLOG
> **Sequential prerequisite:** #33 closed DONE with merged PR and verification.

### Objective
One physical aircraft can have multiple observed flight sessions without confusing them with its persistent identity.

### Exact implementation requirements
1. Define FlightSessionId, aircraft association, validity interval, boundary evidence, confidence reason and immutable revision history.
2. Segment observed positions by actual departure/arrival/gap evidence; do not infer scheduled origin/destination from heading.
3. Represent `OPEN`, `CLOSED`, `UNCERTAIN` and corrected segments; retain raw positions and superseded assignment history.
4. Make session update and its outbox event atomic and idempotent per observation/revision.
5. Expose a small query port for sessions overlapping an aircraft and reliable time interval.

### Target ownership / locations
`flight-tracking/flight-sessions/domain`, application, persistence migration.

### Verification to execute
- Two consecutive flights of the same aircraft, turnarounds, out-of-order positions, long gaps and corrections.
- Real DB concurrent segment update and history preservation.

### Definition of done — task-specific
- Separate physical aircraft and FlightSession identities are enforced.
- Historical session revisions are reproducible.
- Uncertain boundaries do not force a guessed flight.
- Merged PR, local and remote CI status, actual test evidence and limitations recorded; epic updated.

### Non-goals
No message-to-session matching.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Read before coding

Inspect `AGENTS.md`, `docs/ROADMAP.md`, `docs/architecture/ARCHITECTURE_V2.md`, the immediate predecessor's PR and code anchors: modules/aircraft-correlation/domain/temporal-alias.ts; flight tracking observations #16.

#### New modules / exact ownership

Proposed files: modules/flight-tracking/flight-sessions/{domain,application,ports,infrastructure/postgres}. Create these paths only if absent; existing Stage2 context does NOT already implement this feature. Export narrow public API; do not bypass architecture checker.

#### Explicit contract and invariants

FlightSession = {sessionId,aircraftId,validFrom?,validUntil?,status:OPEN|CLOSED|UNCERTAIN,revision,evidenceRefs}; no equality with AircraftId.

#### Implementation algorithm, failure and test cases

Append immutable segment revisions, mark gaps/uncertainty; don't infer scheduled airport from heading. Test consecutive legs, overlap ambiguity and source delay.

#### Execution protocol for an implementation agent

1. Verify previous issue DONE with merged PR; update this issue body to IN PROGRESS with UTC date, branch, owner, planned files and blockers.

2. Add validated data types and pure policy tests, then smallest application use case, narrow ports, adapters, composition root, contract tests and persistence migration if needed. Do not implement later issues in the same PR.

3. Verify unusual timing, unknown metadata, repeat deliveries, authorization and revision races. Run `npm run check`; real PG integration for SQL; E2E for UI/WS; record command/result, including remote CI separately.

4. Change issue status to IN REVIEW with PR, update checked criteria only after actual proof and record architecture impact, migrations, rollback and limits. After merge set DONE/close and update EPIC #4 counts plus successor READY.

5. Missing licensing/decoder samples must be reported as BLOCKED with exact permission owner/action, never substituted with artificial data advertised as live.

### Agent implementation blueprint (2026-11-19)

> **Engineering baseline:** Stage2 `main@373a2755`, with Stage3–5 outputs as dependencies. Paths listed as planned are created only in this issue. Keep each pure domain module independent of HTTP, database and provider SDK.

#### Existing/predecessor implementation to read
- `Stage4 #17 temporal fleet identity and #19 observed track`
- `packages/backend/src/modules/aircraft-correlation/domain/temporal-alias.ts`
- `packages/backend/src/modules/database-transactions/public/index.ts`
- `docs/architecture/ARCHITECTURE_V2.md §4.1 / §6.2`

#### Proposed files and module ownership
- `packages/backend/src/modules/flight-tracking/domain/{flight-session.ts,session-boundary-evidence.ts,segment-observations.ts}`
- `packages/backend/src/modules/flight-tracking/application/{open-session.ts,close-session.ts,revise-session.ts}`
- `packages/backend/src/modules/flight-tracking/ports/session-committer.ts`
- `db/migrations/<next>_flight_sessions.sql`
- `packages/backend/tests/integration/flight-sessions.test.mjs`

#### Required domain and storage contracts
1. Session `FlightSessionId` is distinct from `AircraftId`, `FlightNumber`, airline code or observed callsign. Persist `{sessionId,aircraftId,window:{from,to?},state,revision,boundaryEvidence,policyVersion}` and immutable change history.
2. Boundary decisions may be `OPEN`, `CLOSED`, `UNCERTAIN`, or `SUPERSEDED`, with time uncertainties and evidence source. A gap is evidence of uncertainty, not necessarily an arrival/next departure.
3. Versioned assignment of positions to a session must preserve immutable position facts and allow a later correction without changing historical flight IDs arbitrarily.

#### Execution sequence for coding agent
- **Step 1.** Define stable session ID/validated event time types and pure functions `mayOpen`, `mayClose`, `splitSession`, `selectBoundaryEvidence`. Document required evidence thresholds.
- **Step 2.** Use observed position/ground data and timestamp gaps to propose segments; keep unknown start/end intervals explicit. Do not infer origin/destination or scheduled flight number.
- **Step 3.** Add `tracking.flight_session_revisions` and `tracking.session_heads` plus observation-link history and relevant indexes, with transaction/outbox atomicity and concurrency checks.
- **Step 4.** Provide `SessionReader.findOverlapping(aircraftId,timeRange)` that returns complete candidate set and revision for the future message-flight correlator.
- **Step 5.** Expose immutable session snapshots and restoration/rebuild use cases; avoid making UI decide boundaries.

#### Regression tests / observable success
- One aircraft performs two flight legs in one day; positions between legs remain correctly associated or unknown.
- Long observation gap, apparent ground stop, ambiguous turnaround, out-of-order history and session split/merge corrections.
- Concurrent first write vs revision CAS with rollback and public contract tests.
- All existing aircraft/position history remains intact after re-segmentation.

#### Explicit next-stage handoff
No message matching in this issue; #35 correlates to sessions separately.

#### Completion record to update
- Keep original criteria and tick tested steps, link merged PR+SHA and any migrations, list actual test results, rights/security blockers and rollback.
- Update this issue's status and EPIC #4 task checkbox/count after acceptance; do not run later implementation tasks early.
- All code/documentation/PR text English; remote CI result must be distinguished from local tests.


---

## 31. [#35] Implement independent Message-to-FlightSession correlation

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/35  
**Phase:** Stage 6 · Advanced domains  
**Snapshot status:** BACKLOG · **Dependency:** Issue #34 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 31 · **Stage:** 6 — Advanced aviation domains · **Status:** BACKLOG
> **Sequential prerequisite:** #34 closed DONE with merged PR and verification.

### Objective
Messages can be associated with a known aircraft yet remain unassigned to a particular leg when evidence is insufficient.

### Exact implementation requirements
1. Use the existing accepted Message→Aircraft decision as an explicit input; do not require a session to establish aircraft identity.
2. Retrieve sessions belonging to the same aircraft and intersect them with message observation-time uncertainty.
3. Compare callsign within the session and other validated evidence; veto competing sessions and contradictions.
4. Return tagged `MATCHED/UNMATCHED/AMBIGUOUS/CONFLICTED` decisions and separate flight-link revisions with evidence/policy version.
5. Reprocess flight links when session boundaries or aircraft decisions change, without rewriting older decisions.

### Target ownership / locations
`correlation/flight-link` domain evidence rules, use case, ports, revision adapter.

### Verification to execute
- Aircraft matched but no flight; two consecutive flights; boundary overlap; ambiguous callsign; changed session revision.
- SQL decision/outbox atomics and independent history tests.

### Definition of done — task-specific
- Message may appear on aircraft panel without an unearned flight label.
- Revisions and evidence support correction and audit.
- UI can read flight/session linkage separately.
- Merged PR, local and remote CI status, actual test evidence and limitations recorded; epic updated.

### Non-goals
No fragment decoding or station management.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Read before coding

Inspect `AGENTS.md`, `docs/ROADMAP.md`, `docs/architecture/ARCHITECTURE_V2.md`, the immediate predecessor's PR and code anchors: modules/aircraft-correlation/domain/decide-aircraft-match.ts; session reader from #34.

#### New modules / exact ownership

Proposed files: modules/correlation/flight-link/{domain,application,ports,infrastructure}. Create these paths only if absent; existing Stage2 context does NOT already implement this feature. Export narrow public API; do not bypass architecture checker.

#### Explicit contract and invariants

FlightLinkDecision independent of AircraftLink: MATCHED(sessionId) | UNMATCHED | AMBIGUOUS | CONFLICTED, stores policy and evidence revisions.

#### Implementation algorithm, failure and test cases

Only consider sessions belonging to already matched aircraft in reliable event-time window; if no session still show aircraft message. Tests callsign collision and historical corrections.

#### Execution protocol for an implementation agent

1. Verify previous issue DONE with merged PR; update this issue body to IN PROGRESS with UTC date, branch, owner, planned files and blockers.

2. Add validated data types and pure policy tests, then smallest application use case, narrow ports, adapters, composition root, contract tests and persistence migration if needed. Do not implement later issues in the same PR.

3. Verify unusual timing, unknown metadata, repeat deliveries, authorization and revision races. Run `npm run check`; real PG integration for SQL; E2E for UI/WS; record command/result, including remote CI separately.

4. Change issue status to IN REVIEW with PR, update checked criteria only after actual proof and record architecture impact, migrations, rollback and limits. After merge set DONE/close and update EPIC #4 counts plus successor READY.

5. Missing licensing/decoder samples must be reported as BLOCKED with exact permission owner/action, never substituted with artificial data advertised as live.

### Agent implementation blueprint (2026-11-19)

> **Engineering baseline:** Stage2 `main@373a2755`, with Stage3–5 outputs as dependencies. Paths listed as planned are created only in this issue. Keep each pure domain module independent of HTTP, database and provider SDK.

#### Existing/predecessor implementation to read
- `packages/backend/src/modules/aircraft-correlation/domain/{match-decision.ts,decide-aircraft-match.ts,correlation-input.ts}`
- `packages/backend/src/modules/aircraft-correlation/ports/{candidate-directory.ts,decision-transaction.ts}`
- `Stage6 #34 session reader`
- `packages/backend/src/modules/message-availability/application/update-availability.ts`

#### Proposed files and module ownership
- `packages/backend/src/modules/flight-correlation/domain/{flight-link-decision.ts,flight-evidence.ts,decide-flight-link.ts}`
- `packages/backend/src/modules/flight-correlation/application/{resolve-message-flight.ts,reevaluate-flight-link.ts}`
- `packages/backend/src/modules/flight-correlation/ports/{session-candidates.ts,flight-link-committer.ts}`
- `db/migrations/<next>_flight_links.sql`
- `packages/backend/tests/integration/flight-link-correlation.test.mjs`

#### Required domain and storage contracts
1. Input has `MessageId`, current accepted `AircraftLinkDecision {status,aircraftId?,revision}`, `observedAt` with uncertainty and candidate FlightSession snapshots. Output is a *separate* tagged `MATCHED(sessionId,evidence)`/`UNMATCHED`/`AMBIGUOUS`/`CONFLICTED` decision.
2. A valid aircraft MATCHED + flight UNMATCHED is normal. Callsign/flight number alone is not evidence of physical aircraft identity; session ownership and observation-window consistency are mandatory.
3. Store independent `(messageId,flightLinkRevision)` history and `sessionIndexRevision`, `aircraftLinkRevision`, `policyVersion`. Never compare these revision counters numerically across aggregates.

#### Execution sequence for coding agent
- **Step 1.** Implement pure `isWithinSessionWindow`, `matchesCallsign`, `rejectAircraftMismatch`, `selectUniqueSession` and `decideFlightLink` functions in a dedicated module.
- **Step 2.** Expose an application use case that checks aircraft-link completeness, reads session candidates from #34 at message time and computes tagged result without guessing.
- **Step 3.** Persist immutable flight-link history/head and outbox in one narrow transaction with CAS on message/flight head; never modify aircraft-link decision as a shortcut.
- **Step 4.** Trigger bounded re-evaluation when aircraft assignment or session boundary changes, preserving old match and evidence for audit.
- **Step 5.** Extend read DTOs with `flightSessionId?: string` only when MATCHED; leave unknown session absent rather than fictitious `LOT123`.

#### Regression tests / observable success
- Aircraft matched, no sessions => UNMATCHED; two overlapping sessions => AMBIGUOUS.
- Session assigned to different aircraft => veto; exact end timestamp handled by half-open interval policy.
- Late alias/session correction results in revision and revised message panel; no old link remains falsely current.
- Real DB concurrency, immutable history and outbox rollback.

#### Explicit next-stage handoff
Does not implement reassembly or decode new radio protocols. Flight session identifiers can be unknown while messages still belong to physical aircraft.

#### Completion record to update
- Keep original criteria and tick tested steps, link merged PR+SHA and any migrations, list actual test results, rights/security blockers and rollback.
- Update this issue's status and EPIC #4 task checkbox/count after acceptance; do not run later implementation tasks early.
- All code/documentation/PR text English; remote CI result must be distinguished from local tests.


---

## 32. [#36] Implement bounded protocol fragment reassembly and message revisions

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/36  
**Phase:** Stage 6 · Advanced domains  
**Snapshot status:** BACKLOG · **Dependency:** Issue #35 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 32 · **Stage:** 6 — Advanced aviation domains · **Status:** BACKLOG
> **Sequential prerequisite:** #35 closed DONE with merged PR and verification.

### Objective
Frames with genuine fragmentation metadata produce complete or explicitly incomplete logical messages without losing source evidence.

### Exact implementation requirements
1. Define stable protocol-specific assembly keys and sequence/fragment evidence, with an immutable reception/frame reference list.
2. Build a bounded state machine `COLLECTING/COMPLETE/CONFLICTED/EXPIRED` with deadline and max fragments/bytes.
3. Handle out-of-order arrivals, duplicates, missing fragments and same-sequence conflicting contents; no silent overwrite.
4. On completion append MessageRevision and outbox atomically; preserve raw frame occurrences and decoder version.
5. Only apply assembly to protocols whose fragmentation rules are documented; provider-only complete messages bypass it.

### Target ownership / locations
`communications/assembly` domain and use cases, state persistence and decoder ports.

### Verification to execute
- Permutation 3,1,2; duplicate fragment; conflicting retransmission; timeout; oversize; crash/restart.
- Real PostgreSQL state-machine transaction and time-bound recovery tests.

### Definition of done — task-specific
- Assembled content is traceable to real fragments.
- Incomplete messages cannot masquerade as complete ones.
- Decoder extensions use the same finite-state contract where valid.
- Merged PR, local and remote CI status, actual test evidence and limitations recorded; epic updated.

### Non-goals
No RF demodulation inside the web application.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Read before coding

Inspect `AGENTS.md`, `docs/ROADMAP.md`, `docs/architecture/ARCHITECTURE_V2.md`, the immediate predecessor's PR and code anchors: source input levels from #5, protocol rules #10, modules/event-delivery/infrastructure/consume-event.ts.

#### New modules / exact ownership

Proposed files: modules/communications/assembly/{assembly-key,accept-fragment,expire,finalize}.ts. Create these paths only if absent; existing Stage2 context does NOT already implement this feature. Export narrow public API; do not bypass architecture checker.

#### Explicit contract and invariants

AssemblyKey includes protocol, endpoints, sequence context; AssemblySession COLLECTING|COMPLETE|CONFLICTED|EXPIRED; fragment facts remain immutable.

#### Implementation algorithm, failure and test cases

Bound byte count, fragment count, deadline; allow out-of-order only if spec permits. Test 3,1,2, sequence conflict, timeout and restart; don't fake RF fragments from provider messages.

#### Execution protocol for an implementation agent

1. Verify previous issue DONE with merged PR; update this issue body to IN PROGRESS with UTC date, branch, owner, planned files and blockers.

2. Add validated data types and pure policy tests, then smallest application use case, narrow ports, adapters, composition root, contract tests and persistence migration if needed. Do not implement later issues in the same PR.

3. Verify unusual timing, unknown metadata, repeat deliveries, authorization and revision races. Run `npm run check`; real PG integration for SQL; E2E for UI/WS; record command/result, including remote CI separately.

4. Change issue status to IN REVIEW with PR, update checked criteria only after actual proof and record architecture impact, migrations, rollback and limits. After merge set DONE/close and update EPIC #4 counts plus successor READY.

5. Missing licensing/decoder samples must be reported as BLOCKED with exact permission owner/action, never substituted with artificial data advertised as live.

### Agent implementation blueprint (2026-11-19)

> **Engineering baseline:** Stage2 `main@373a2755`, with Stage3–5 outputs as dependencies. Paths listed as planned are created only in this issue. Keep each pure domain module independent of HTTP, database and provider SDK.

#### Existing/predecessor implementation to read
- `docs/architecture/ARCHITECTURE_V2.md §4.2 and §5`
- `Stage3 message provenance and real receiver/frame observation models`
- `packages/backend/src/modules/database-transactions/application/run-sql-transaction.ts`
- `packages/backend/src/modules/event-delivery/infrastructure/consume-event.ts`

#### Proposed files and module ownership
- `packages/backend/src/modules/communications/domain/{assembly-key.ts,assembly-state.ts,accept-fragment.ts,expire-assembly.ts}`
- `packages/backend/src/modules/communications/application/{accept-message-fragment.ts,finalize-message-revision.ts}`
- `packages/backend/src/modules/communications/ports/assembly-session-store.ts`
- `db/migrations/<next>_message_assembly.sql`
- `packages/backend/tests/integration/message-assembly.test.mjs`

#### Required domain and storage contracts
1. State `AssemblySession {key,protocol,decoderVersion,fragmentSequence,receivedFragments,deadline,status}` where status tagged `COLLECTING|COMPLETE|CONFLICTED|EXPIRED` and size limits are explicit.
2. A fragment is identifiable only by protocol-supported context (participant, block/sequence, direction and time bucket, validated actual frame/reception linkage). Repetition of identical text is **not** sufficient to merge messages.
3. Completion creates immutable `MessageRevision` referencing input fragment IDs and decoder version; an imported complete provider message bypasses assembly and cannot generate synthetic frame links.

#### Execution sequence for coding agent
- **Step 1.** Choose first protocol's documented fragment/sequence rules with a versioned `AssemblyKeyPolicy` and rejected-unsupported error; avoid a speculative universal packet format.
- **Step 2.** Write pure bounded state transition functions with deterministic fragment ordering, max fragments/bytes, timeout, conflicting same-sequence detection and idempotent duplicate.
- **Step 3.** Add durable assembly sessions plus fragment references and due-time index, limited write lock per assembly key and transactional commit of completion+outbox.
- **Step 4.** Implement expiry worker that checks expectedRevision/deadline so stale timer cannot expire newer assembly; crashed worker resumes due work.
- **Step 5.** Persist message revision/provenance before passing complete message to correlation, and document incomplete/conflicted representation.

#### Regression tests / observable success
- Arrivals in order 3,1,2 form a complete message if the chosen protocol allows; duplicate fragment does nothing.
- Same fragment index/different bytes => CONFLICTED, missing final => EXPIRED, oversize rejected and quarantine recorded.
- Two workers complete same assembly concurrently => one immutable message revision; crash after write before ACK idempotent.
- Provider-complete message creates no AssemblySession or fabricated RF frame.

#### Explicit next-stage handoff
This is reassembly of decoded fragments, not an SDR demodulator. Protocol-specific decoder adapters follow #39–#42.

#### Completion record to update
- Keep original criteria and tick tested steps, link merged PR+SHA and any migrations, list actual test results, rights/security blockers and rollback.
- Update this issue's status and EPIC #4 task checkbox/count after acceptance; do not run later implementation tasks early.
- All code/documentation/PR text English; remote CI result must be distinguished from local tests.


---

## 33. [#37] Add receiver station onboarding and authenticated feeder intake

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/37  
**Phase:** Stage 6 · Advanced domains  
**Snapshot status:** BACKLOG · **Dependency:** Issue #36 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 33 · **Stage:** 6 — Advanced aviation domains · **Status:** BACKLOG
> **Sequential prerequisite:** #36 closed DONE with merged PR and verification.

### Objective
A contributor can register an SDR installation and upload permitted reception facts with auditable station identity.

### Exact implementation requirements
1. Define station ID, owner, receiver installation ID, capability declarations and lifecycle (active/suspended/revoked).
2. Provide authenticated station registration with token issuance/rotation/revocation and ownership enforcement.
3. Validate feeder uploads by station capability, source time, data level, size and delivery scope before durable acceptance.
4. Store real reception source IDs and reject attempts to spoof another station or a non-reception provider payload.
5. Document sample feeder protocol/SDK and station data rights; do not require precise public coordinates.

### Target ownership / locations
`receiver-network/stations`, feeder authentication + API endpoints, migrations.

### Verification to execute
- Station registration and token rotation; revoked feeder; duplicate uploads; spoofed identity; unsupported receiver capability.
- Real DB grants and HTTP auth integration tests.

### Definition of done — task-specific
- An authenticated owned station can supply an actual reception fact.
- Revoked credentials cannot upload.
- Receiver facts retain provenance through message decoding.
- Merged PR, local and remote CI status, actual test evidence and limitations recorded; epic updated.

### Non-goals
No public crowdsourced station directory or health score.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Read before coding

Inspect `AGENTS.md`, `docs/ROADMAP.md`, `docs/architecture/ARCHITECTURE_V2.md`, the immediate predecessor's PR and code anchors: modules/access from #26, source delivery #8, source contracts #5.

#### New modules / exact ownership

Proposed files: modules/receiver-network/{domain,application,ports,postgres}; apps/api/src/routing/feeder. Create these paths only if absent; existing Stage2 context does NOT already implement this feature. Export narrow public API; do not bypass architecture checker.

#### Explicit contract and invariants

StationId+owner+installation+declared capabilities; feeder upload requires verified station token and genuine RECEIVER_RECEPTION input; scope independent from viewing rights.

#### Implementation algorithm, failure and test cases

Provision lifecycle + token rotate/revoke, rate budgets, station spoofing rejection, no exact coordinates by default. Test revoked feeder and duplicate delivery.

#### Execution protocol for an implementation agent

1. Verify previous issue DONE with merged PR; update this issue body to IN PROGRESS with UTC date, branch, owner, planned files and blockers.

2. Add validated data types and pure policy tests, then smallest application use case, narrow ports, adapters, composition root, contract tests and persistence migration if needed. Do not implement later issues in the same PR.

3. Verify unusual timing, unknown metadata, repeat deliveries, authorization and revision races. Run `npm run check`; real PG integration for SQL; E2E for UI/WS; record command/result, including remote CI separately.

4. Change issue status to IN REVIEW with PR, update checked criteria only after actual proof and record architecture impact, migrations, rollback and limits. After merge set DONE/close and update EPIC #4 counts plus successor READY.

5. Missing licensing/decoder samples must be reported as BLOCKED with exact permission owner/action, never substituted with artificial data advertised as live.

### Agent implementation blueprint (2026-11-19)

> **Engineering baseline:** Stage2 `main@373a2755`, with Stage3–5 outputs as dependencies. Paths listed as planned are created only in this issue. Keep each pure domain module independent of HTTP, database and provider SDK.

#### Existing/predecessor implementation to read
- `Stage5 #26 Principal/Capability authorization contracts`
- `Stage3 #7 provider-delivery tables and #8 acceptance semantics`
- `packages/backend/src/modules/source-connectors/public/index.ts`
- `docs/architecture/ARCHITECTURE_V2.md receiver-network section`

#### Proposed files and module ownership
- `packages/backend/src/modules/receiver-network/domain/{station.ts,receiver-installation.ts,receiver-capability.ts}`
- `packages/backend/src/modules/receiver-network/application/{register-station.ts,rotate-feeder-token.ts,accept-reception-upload.ts}`
- `packages/backend/src/modules/receiver-network/ports/{station-store.ts,credential-issuer.ts}`
- `db/migrations/<next>_receiver_network.sql`
- `apps/api/src/routing/station-feeder.ts`
- `apps/api/tests/integration/feeder-auth.test.mjs`

#### Required domain and storage contracts
1. Identity model: `StationId`, `ReceiverInstallationId`, owner `PrincipalId`, capabilities `{protocols,decoderVersion,frequencyRanges}`, credential epoch/revocation history; a station is not synonymous with an aircraft or provider account.
2. Proposed authenticated `POST /api/v1/feeder/deliveries` payload includes externalDeliveryId, actual station ID, actual observation time, data level and permitted reception evidence. ACK means **durably accepted**, not decoded/published.
3. Token issuer stores hash/metadata, not plaintext token; tokens are scoped to owned station + `upload:reception` capability and rotate/revoke safely. A provider-only message cannot fake station reception evidence.

#### Execution sequence for coding agent
- **Step 1.** Implement pure station and installation models with explicit registration/suspension/revocation state and capability validation.
- **Step 2.** Persist stations, installations, token hashes, capability revisions and audit records under a dedicated schema/owner with restricted roles.
- **Step 3.** Build a feeder endpoint using Stage5 auth and Stage3 source-delivery acceptance; verify station owner and actual decoder capability before accepting each envelope.
- **Step 4.** Add token rotation/revocation (old token invalid), bounded batch upload, safe per-item error reporting and station identity path; no user-provided arbitrary owner ID.
- **Step 5.** Document feeder JSON contract and an example offline client that sends synthetic reception facts, with no live station coordinates in Git.

#### Regression tests / observable success
- Valid token + owned station accepts one real reception fact; other station ID rejected.
- Duplicate delivery idempotent; payload mismatch conflict; token rotation expiry, disabled station and overlarge upload.
- Restart preserves token revocation; SQL uniqueness/concurrent station registration, no raw secrets returned in read DTO.
- Integration tests with real PostgreSQL and API scope checks.

#### Explicit next-stage handoff
Health/coverage is issue #38. Registering a station does not make its location/public messages automatically visible.

#### Completion record to update
- Keep original criteria and tick tested steps, link merged PR+SHA and any migrations, list actual test results, rights/security blockers and rollback.
- Update this issue's status and EPIC #4 task checkbox/count after acceptance; do not run later implementation tasks early.
- All code/documentation/PR text English; remote CI result must be distinguished from local tests.


---

## 34. [#38] Compute station health and scoped coverage without overclaiming reception

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/38  
**Phase:** Stage 6 · Advanced domains  
**Snapshot status:** BACKLOG · **Dependency:** Issue #37 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 34 · **Stage:** 6 — Advanced aviation domains · **Status:** BACKLOG
> **Sequential prerequisite:** #37 closed DONE with merged PR and verification.

### Objective
Station liveness and observational coverage are distinct, privacy-aware data products.

### Exact implementation requirements
1. Receive authenticated heartbeats and versioned receiver/decoder capabilities; record last seen and lag.
2. Compute `HEALTHY/DEGRADED/DISCONNECTED` from connection/decoder signals, not merely message count.
3. Describe coverage by receiver bands, rough footprint, sampling and time; never claim that an aircraft did not transmit.
4. Implement owner-controlled station-location precision/withholding before public projection.
5. Expose station list/details and coverage labels in UI with scope-based visibility.

### Target ownership / locations
`receiver-network/health`, coverage descriptors, station read model and UI.

### Verification to execute
- No radio traffic on a healthy station, dropped heartbeat, sampling, clock skew and location privacy.
- API/UI tests ensure hidden station coordinates and receivers do not leak.

### Definition of done — task-specific
- Health vs coverage semantics are independently visible.
- Station location exposure follows owner policy.
- Coverage does not misuse frame count as a reception guarantee.
- Merged PR, local and remote CI status, actual test evidence and limitations recorded; epic updated.

### Non-goals
No provider-specific protocol decoding.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Read before coding

Inspect `AGENTS.md`, `docs/ROADMAP.md`, `docs/architecture/ARCHITECTURE_V2.md`, the immediate predecessor's PR and code anchors: receiver-network station schema from #37, modules/message-availability/domain/{coverage,feed-health}.ts.

#### New modules / exact ownership

Proposed files: modules/receiver-network/{heartbeat,station-health,coverage}/; read-models/station-list. Create these paths only if absent; existing Stage2 context does NOT already implement this feature. Export narrow public API; do not bypass architecture checker.

#### Explicit contract and invariants

Health = HEALTHY|DEGRADED|DISCONNECTED based on heartbeat/decoder errors; coverage = sampled/station scoped/unknown and location privacy precision.

#### Implementation algorithm, failure and test cases

Keep zero messages on connected station HEALTHY possible; avoid aircraft did-not-transmit claims. Test heartbeat timeout, skew, sample limitations and location redaction.

#### Execution protocol for an implementation agent

1. Verify previous issue DONE with merged PR; update this issue body to IN PROGRESS with UTC date, branch, owner, planned files and blockers.

2. Add validated data types and pure policy tests, then smallest application use case, narrow ports, adapters, composition root, contract tests and persistence migration if needed. Do not implement later issues in the same PR.

3. Verify unusual timing, unknown metadata, repeat deliveries, authorization and revision races. Run `npm run check`; real PG integration for SQL; E2E for UI/WS; record command/result, including remote CI separately.

4. Change issue status to IN REVIEW with PR, update checked criteria only after actual proof and record architecture impact, migrations, rollback and limits. After merge set DONE/close and update EPIC #4 counts plus successor READY.

5. Missing licensing/decoder samples must be reported as BLOCKED with exact permission owner/action, never substituted with artificial data advertised as live.

### Agent implementation blueprint (2026-11-19)

> **Baseline:** Stage2 `main@373a2755` and preceding Stage3–6 deliverables. These are proposed paths; inspect real merged predecessor code before implementation. No invented provider rights, decoder capability or transmission data.

#### Existing interfaces and supporting code
- `packages/backend/src/modules/message-availability/domain/{feed-health.ts,coverage.ts}`
- `Stage6 #37 station registry, installed receiver and capability models`
- `Stage5 #25–#29 publication scope and permitted location views`
- `docs/architecture/ARCHITECTURE_V2.md §7 and receiver-network`

#### Exact ownership / file plan
- `packages/backend/src/modules/receiver-network/domain/{station-heartbeat.ts,compute-station-health.ts,coverage-descriptor.ts,location-precision-policy.ts}`
- `packages/backend/src/modules/receiver-network/application/{record-heartbeat.ts,get-station-overview.ts}`
- `packages/backend/src/modules/receiver-network/infrastructure/postgres/{pg-station-heartbeats.ts,pg-station-health.ts}`
- `apps/web/src/features/receiver-stations/{StationList.tsx,StationDetails.tsx}`
- `packages/backend/tests/station-health.test.mjs`

#### Proposed typed contracts and hard invariants
1. `StationHealth {stationId,state:'HEALTHY'|'DEGRADED'|'DISCONNECTED',lastHeartbeatAt,lastDecoderAt,reason,asOf}` must derive from heartbeat, receiver process and decoder signals, **not from radio-message counts**.
2. `CoverageDescriptor {stationId,bands,capabilities,asOf,kind:'STATION_SCOPED'|'UNKNOWN',area?}` describes observations and permitted location precision; 0 receptions does not mean aircraft did not transmit.
3. `LocationExposure` controls exact, rounded region or withheld coordinates by owner/grant policy. Counts and station IDs that could reveal confidential activity must be scope-filtered.

#### Stepwise implementation plan
- **Step 1.** Validate signed station heartbeat with installation ID, monotonic session epoch, decoder version, status and provider timestamps; store immutable snapshots under owned station.
- **Step 2.** Implement pure health classifier with explicit threshold/clock tolerance policy and ability to recompute after restart; old heartbeat cannot refresh new session.
- **Step 3.** Build scope-qualified station card read model using publication grant; strip private source/receiver coordinates before counting/rendering.
- **Step 4.** Add a compact station-list UI with accessible health label, coverage qualifiers and owner-permitted details; avoid map pin on exact private coordinates.
- **Step 5.** Document feed observability: sampled global feed vs station coverage vs disconnected process are distinct states.

#### Test requirements and failure branches
- Healthy station that hears no aircraft stays HEALTHY; recent frames with stopped heartbeat show disconnected station.
- Replayed older heartbeat cannot override current epoch; clock skew and version change handled explicitly.
- Owner sees precise coordinates; public principal sees withheld/rounded location and no hidden receiver IDs/counts.
- Real DB test verifies station health projections persist over restart and revocation.

#### Handoff / exclusion
Decoder and protocol-specific message extraction is handled separately by #39–#42. Do not infer source completeness.

#### Closing checklist
- Original and additional acceptance checks verified; PR, actual command outputs, migration/decoder version, residual limitations and license evidence in issue status log.
- Merge and verify this issue before updating EPIC #4 and marking the next item READY; keep all code/doc/UI English.
- Do not claim GitHub CI passed if the Actions runner did not run.


---

## 35. [#39] Build versioned protocol-stack decoder registry and extension contract

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/39  
**Phase:** Stage 6 · Advanced domains  
**Snapshot status:** BACKLOG · **Dependency:** Issue #38 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 35 · **Stage:** 6 — Advanced aviation domains · **Status:** BACKLOG
> **Sequential prerequisite:** #38 closed DONE with merged PR and verification.

### Objective
Adding an aviation protocol requires a small adapter and tests, not changes to central domain transport switches.

### Exact implementation requirements
1. Define bearer vs application-protocol stack, direction, decoder version, data level and supported capability flags.
2. Use a versioned registry with explicit parser registration, unsupported-protocol outcome and strict error types.
3. Preserve decoder source and input frame/message evidence for every revision.
4. Provide sanitized golden-fixture format and adapter contract tests that a new protocol must pass.
5. Retain unknown protocol branches without claiming ACARS if only VDL2/HFDL bearer evidence exists.

### Target ownership / locations
`communications/protocol-registry`, decoder adapter ports, schema versions and docs.

### Verification to execute
- Multiple protocol stacks, unknown application, decoder version upgrade, malformed extensions and direction handling.
- Boundary/type tests verify a provider adapter cannot import private domain internals.

### Definition of done — task-specific
- A second decoder implementation can register without changing central ingestion rules.
- Unknown data never gets a fabricated decoded message.
- Published decoding provenance is versioned.
- Merged PR, local and remote CI status, actual test evidence and limitations recorded; epic updated.

### Non-goals
Individual VHF, HFDL and SATCOM adapters are separate issues.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Read before coding

Inspect `AGENTS.md`, `docs/ROADMAP.md`, `docs/architecture/ARCHITECTURE_V2.md`, the immediate predecessor's PR and code anchors: source parsing from #10, communications assembly from #36.

#### New modules / exact ownership

Proposed files: modules/communications/protocol-registry/{decoder-port,registry,versioned-codec}.ts. Create these paths only if absent; existing Stage2 context does NOT already implement this feature. Export narrow public API; do not bypass architecture checker.

#### Explicit contract and invariants

Decoder registry keyed by bearer, application protocol and decoder version; Result<LogicalMessage|Unsupported,DecodeError>. VDL2 bearer does not imply ACARS.

#### Implementation algorithm, failure and test cases

Use explicit registration and capability contract; unknown branch remains typed evidence. Test two decoders, version migration, wrong direction and malformed format.

#### Execution protocol for an implementation agent

1. Verify previous issue DONE with merged PR; update this issue body to IN PROGRESS with UTC date, branch, owner, planned files and blockers.

2. Add validated data types and pure policy tests, then smallest application use case, narrow ports, adapters, composition root, contract tests and persistence migration if needed. Do not implement later issues in the same PR.

3. Verify unusual timing, unknown metadata, repeat deliveries, authorization and revision races. Run `npm run check`; real PG integration for SQL; E2E for UI/WS; record command/result, including remote CI separately.

4. Change issue status to IN REVIEW with PR, update checked criteria only after actual proof and record architecture impact, migrations, rollback and limits. After merge set DONE/close and update EPIC #4 counts plus successor READY.

5. Missing licensing/decoder samples must be reported as BLOCKED with exact permission owner/action, never substituted with artificial data advertised as live.

### Agent implementation blueprint (2026-11-19)

> **Baseline:** Stage2 `main@373a2755` and preceding Stage3–6 deliverables. These are proposed paths; inspect real merged predecessor code before implementation. No invented provider rights, decoder capability or transmission data.

#### Existing interfaces and supporting code
- `Stage3 source canonical observation contracts and provenance`
- `Stage6 #36 `AssemblySession` use case`
- `packages/backend/src/demo/domain/bearer.ts`
- `docs/architecture/ARCHITECTURE_V2.md §4.3`

#### Exact ownership / file plan
- `packages/backend/src/modules/communications/domain/{protocol-id.ts,protocol-stack.ts,decode-outcome.ts}`
- `packages/backend/src/modules/communications/ports/protocol-decoder.ts`
- `packages/backend/src/modules/communications/application/resolve-decoder.ts`
- `packages/backend/src/modules/communications/infrastructure/protocol-registry.ts`
- `packages/backend/tests/protocol-registry.test.mjs`
- `docs/DECODER_CONTRACT.md`

#### Proposed typed contracts and hard invariants
1. Use `ProtocolStack {bearer,linkProtocol?,applicationProtocol?,direction}` distinct from `bearer` alone. A `VDL2` or `HFDL` transport can carry an unknown/non-ACARS application; do not auto-label all as ACARS.
2. Decoder generic: `ProtocolDecoder<TInput,TResult>.supports(capability,version)` and `decode(input): Result<DecodedObservation,{code,version,retryable}>` with immutable input refs, decoder version and optional fragment metadata. A decoder returns observations, not commits SQL.
3. Registry maps validated `(bearer,protocolId,wireSchemaVersion)` to exactly one approved implementation; duplicate registrations and unsupported versions must return explicit errors.

#### Stepwise implementation plan
- **Step 1.** Define pure protocol identifiers/stack/direction and parse them with discriminated unions plus stable `UNKNOWN` behavior.
- **Step 2.** Add a narrow decoder port and a composition-only registry backed by map from protocol capability+version to adapter; no global service locator.
- **Step 3.** Implement strict input/output validation around each adapter, retaining provenance and a versioned decode result; do not permit implicit `any`.
- **Step 4.** Route actual fragment output through Stage6 #36 reassembly and complete logical messages through Stage3 provider-message import contracts.
- **Step 5.** Document developer instructions to register a new decoder: capability declaration, input schema, golden fixtures, coverage/rights limitations and required contract tests.

#### Test requirements and failure branches
- Two distinct bearers with same application, unknown application over VDL2, invalid direction, duplicate registration and unknown schema version.
- Decoder returns malformed output, unsupported fragment, version change and exceptions: normalized outcome and quarantine.
- No transport-specific SDK imported into pure domain/ports; all existing ingestion tests stay green.

#### Handoff / exclusion
#40, #41, #42 implement concrete protocol adapters against this interface. Registry alone must not claim any new protocols are decoded.

#### Closing checklist
- Original and additional acceptance checks verified; PR, actual command outputs, migration/decoder version, residual limitations and license evidence in issue status log.
- Merge and verify this issue before updating EPIC #4 and marking the next item READY; keep all code/doc/UI English.
- Do not claim GitHub CI passed if the Actions runner did not run.


---

## 36. [#40] Implement and validate VHF ACARS message decoding adapter

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/40  
**Phase:** Stage 6 · Advanced domains  
**Snapshot status:** BACKLOG · **Dependency:** Issue #39 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 36 · **Stage:** 6 — Advanced aviation domains · **Status:** BACKLOG
> **Sequential prerequisite:** #39 closed DONE with merged PR and verification.

### Objective
Actual permitted VHF ACARS observations are normalized into versioned logical messages while retaining RF evidence when provided.

### Exact implementation requirements
1. Verify decoder/library and redistribution rights and document exact supported message format/input level.
2. Wrap the selected decoder as an isolated adapter; map address direction, flight hints, message label, block ID and decoder errors.
3. Pass fragmented content to S6-03 where protocol rules justify assembly; preserve message IDs and reception provenance.
4. For undecodable messages, retain source evidence with a typed failure and never create an arbitrary text message.
5. Register protocol capabilities and validate with redacted approved examples.

### Target ownership / locations
`communications/infrastructure/decoders/vhf-acars`, fixtures and adapter tests.

### Verification to execute
- VHF ACARS downlink/uplink, framing errors, fragment cases, repeated blocks and message labels.
- Provider golden fixtures and real-DB ingestion integration test.

### Definition of done — task-specific
- One actual supported VHF ACARS data level reaches the canonical message store.
- Errors are inspectable and safe to retry/quarantine.
- No unsupported field is invented.
- Merged PR, local and remote CI status, actual test evidence and limitations recorded; epic updated.

### Non-goals
No HFDL or SATCOM support in this issue.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Read before coding

Inspect `AGENTS.md`, `docs/ROADMAP.md`, `docs/architecture/ARCHITECTURE_V2.md`, the immediate predecessor's PR and code anchors: protocol registry #39, source message normalization #10.

#### New modules / exact ownership

Proposed files: modules/communications/infrastructure/decoders/vhf-acars/. Create these paths only if absent; existing Stage2 context does NOT already implement this feature. Export narrow public API; do not bypass architecture checker.

#### Explicit contract and invariants

VHF_ACARS decoder produces message label, blockId, source/direction, parser version and optional fragment metadata; raw RF only when actually supplied.

#### Implementation algorithm, failure and test cases

Use authorized decoder/test fixtures, queue fragments through #36, reject malformed/partial data without fake complete message. Tests uplink/downlink, repeats, block IDs.

#### Execution protocol for an implementation agent

1. Verify previous issue DONE with merged PR; update this issue body to IN PROGRESS with UTC date, branch, owner, planned files and blockers.

2. Add validated data types and pure policy tests, then smallest application use case, narrow ports, adapters, composition root, contract tests and persistence migration if needed. Do not implement later issues in the same PR.

3. Verify unusual timing, unknown metadata, repeat deliveries, authorization and revision races. Run `npm run check`; real PG integration for SQL; E2E for UI/WS; record command/result, including remote CI separately.

4. Change issue status to IN REVIEW with PR, update checked criteria only after actual proof and record architecture impact, migrations, rollback and limits. After merge set DONE/close and update EPIC #4 counts plus successor READY.

5. Missing licensing/decoder samples must be reported as BLOCKED with exact permission owner/action, never substituted with artificial data advertised as live.

### Agent implementation blueprint (2026-11-19)

> **Baseline:** Stage2 `main@373a2755` and preceding Stage3–6 deliverables. These are proposed paths; inspect real merged predecessor code before implementation. No invented provider rights, decoder capability or transmission data.

#### Existing interfaces and supporting code
- `Stage6 #39 decoder registry and contract-test guide`
- `Stage6 #36 fragment reassembly where applicable`
- `Stage3 #7–#11 permitted source and reception lineage`
- `docs/PUBLICATION_POLICY.md / Stage5 grants`

#### Exact ownership / file plan
- `packages/backend/src/modules/communications/infrastructure/decoders/vhf-acars/{decode-vhf-acars.ts,map-acars-fields.ts,register.ts}`
- `packages/backend/tests/fixtures/decoders/vhf-acars/README.md`
- `packages/backend/tests/vhf-acars-decoder.test.mjs`
- `packages/backend/tests/integration/vhf-acars-import.test.mjs`

#### Proposed typed contracts and hard invariants
1. Input is genuine permitted VHF ACARS decoded/framed data, with fields that actually exist (ground-air direction, labels, aircraft address, block/sequence when supplied, source receiver and actual observedAt).
2. Output `DecodedObservation` with bearer `VHF_ACARS`, application `ACARS` only when message is recognized, decoder name/version, optional fragment context and source evidence references.
3. Unknown/invalid content becomes typed `UNSUPPORTED`, `MALFORMED`, or `INCOMPLETE`, not fake plaintext, station, frame or inferred flight. Public representation remains governed by Stage5 entitlements.

#### Stepwise implementation plan
- **Step 1.** Identify compatible documented VHF ACARS decoder/library and verify license/source permission for integration and test fixture distribution.
- **Step 2.** Write a small transport-decoder wrapper preserving raw/reception linkage where provided, and pure mappers for aircraft address role, label, block ID, sequence and text encoding.
- **Step 3.** Integrate supported fragment cases via `AssemblySession` without text-hash dedup and preserve new MessageRevision per actual transmission.
- **Step 4.** Register adapter through #39 registry and implement schema validation on runtime input; use strict bounded payload/fragment limits.
- **Step 5.** Use approved redacted real-shape fixtures, no sensitive payload in CI or Git, and document exactly which message labels are supported.

#### Test requirements and failure branches
- Uplink/downlink aircraft-address roles; supported labels, invalid parity/framing, duplicate block and fragment reassembly.
- Same text at different actual times remains separate; missing receiver evidence doesn't create a station record.
- Decoder failure quarantines safely, original reception remains; real PostgreSQL ingestion and provenance contract test.

#### Handoff / exclusion
HFDL and SATCOM belong to separate issues. Do not silently interpret other bearers as VHF ACARS.

#### Closing checklist
- Original and additional acceptance checks verified; PR, actual command outputs, migration/decoder version, residual limitations and license evidence in issue status log.
- Merge and verify this issue before updating EPIC #4 and marking the next item READY; keep all code/doc/UI English.
- Do not claim GitHub CI passed if the Actions runner did not run.


---

## 37. [#41] Implement and validate HFDL observations through the decoder registry

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/41  
**Phase:** Stage 6 · Advanced domains  
**Snapshot status:** BACKLOG · **Dependency:** Issue #40 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 37 · **Stage:** 6 — Advanced aviation domains · **Status:** BACKLOG
> **Sequential prerequisite:** #40 closed DONE with merged PR and verification.

### Objective
HFDL data is accepted at its actual decoded level and clearly separated from VHF/VDL2 messaging.

### Exact implementation requirements
1. Verify accessible lawful HFDL source and exact supported frame/message formats; block if an authorized fixture is unavailable.
2. Map HFDL bearer and application protocol independently, preserving time uncertainty, direction, source and decoder version.
3. Use the common protocol registry and reassembly only for proven supported fragment semantics.
4. Keep unknown data or unsupported message types as evidence with an explicit decoding outcome.
5. Document HFDL-specific operational constraints (coverage, timing, incomplete decoding).

### Target ownership / locations
`communications/infrastructure/decoders/hfdl`, source parser and integration tests.

### Verification to execute
- Authorized anonymized HFDL fixtures for valid, partial and invalid data.
- Replay/idempotency and message-level provenance integration tests.

### Definition of done — task-specific
- An authorized HFDL fixture roundtrips through canonical storage with correct bearer.
- HFDL is never mislabeled as VDL2 or automatically as ACARS.
- Unsupported variants fail visibly.
- Merged PR, local and remote CI status, actual test evidence and limitations recorded; epic updated.

### Non-goals
No SATCOM decoding or provider-side coverage inference.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Read before coding

Inspect `AGENTS.md`, `docs/ROADMAP.md`, `docs/architecture/ARCHITECTURE_V2.md`, the immediate predecessor's PR and code anchors: protocol registry #39, provenance #7.

#### New modules / exact ownership

Proposed files: modules/communications/infrastructure/decoders/hfdl/. Create these paths only if absent; existing Stage2 context does NOT already implement this feature. Export narrow public API; do not bypass architecture checker.

#### Explicit contract and invariants

HFDL bearer and actual decoded protocol stack are independent; canonical observation carries time evidence, source and decoder version.

#### Implementation algorithm, failure and test cases

Only parse licensed known HFDL fixture format, unknown application typed unsupported, no VDL2 mislabeled. Test incomplete and duplicates, real PG lineage.

#### Execution protocol for an implementation agent

1. Verify previous issue DONE with merged PR; update this issue body to IN PROGRESS with UTC date, branch, owner, planned files and blockers.

2. Add validated data types and pure policy tests, then smallest application use case, narrow ports, adapters, composition root, contract tests and persistence migration if needed. Do not implement later issues in the same PR.

3. Verify unusual timing, unknown metadata, repeat deliveries, authorization and revision races. Run `npm run check`; real PG integration for SQL; E2E for UI/WS; record command/result, including remote CI separately.

4. Change issue status to IN REVIEW with PR, update checked criteria only after actual proof and record architecture impact, migrations, rollback and limits. After merge set DONE/close and update EPIC #4 counts plus successor READY.

5. Missing licensing/decoder samples must be reported as BLOCKED with exact permission owner/action, never substituted with artificial data advertised as live.

### Agent implementation blueprint (2026-11-19)

> **Baseline:** Stage2 `main@373a2755` and preceding Stage3–6 deliverables. These are proposed paths; inspect real merged predecessor code before implementation. No invented provider rights, decoder capability or transmission data.

#### Existing interfaces and supporting code
- `Stage6 #39 registry and #36 assembly semantics`
- `Stage3 approved source observation contracts`
- `docs/DECODER_CONTRACT.md and provider rights ADR`
- `Stage5 source entitlements and publication rules`

#### Exact ownership / file plan
- `packages/backend/src/modules/communications/infrastructure/decoders/hfdl/{decode-hfdl.ts,map-hfdl-protocol.ts,register.ts}`
- `packages/backend/tests/fixtures/decoders/hfdl/README.md`
- `packages/backend/tests/hfdl-decoder.test.mjs`
- `packages/backend/tests/integration/hfdl-source-import.test.mjs`

#### Proposed typed contracts and hard invariants
1. HFDL is a bearer, not proof that the application payload is ACARS. Parse actual link-layer metadata, direction and protocol stack, keep unrecognized application as UNKNOWN.
2. Observation time may be coarse or delayed; retain provider/receiver clock basis and uncertainty and do not refresh availability using processing time.
3. Use original source delivery/actual receiver provenance with immutable decoder version. If source returns only a complete provider message, bypass RF frame assembly.

#### Stepwise implementation plan
- **Step 1.** Choose lawful source/decoder and document actual HFDL schema, sample format, allowed retention/display; mark BLOCKED if sample/permissions unavailable.
- **Step 2.** Build version-specific mapping for supported HFDL link frame or message level into registry output; validate nested aircraft addressing, sequence, message kind and timing.
- **Step 3.** Wrap unsupported/partially decoded cases as typed outcomes, preserving original evidence references; route fragments only for proven HFDL rules.
- **Step 4.** Hook HFDL decoder through #39 selection without adding a bearer-specific switch to main correlation/use case.
- **Step 5.** Create redacted golden fixtures with documented provenance and replay through durable private ingestion.

#### Test requirements and failure branches
- Valid HFDL sample and unknown application, malformed header, missing frame, high timestamp uncertainty and link-direction cases.
- Distinct HFDL retransmissions vs duplicate source delivery and out-of-order fragments.
- Real DB end-to-end decoder→message revision with no invented station/RF bytes; required rights gating.

#### Handoff / exclusion
Do not claim HFDL signal coverage globally. SATCOM adapter follows independently.

#### Closing checklist
- Original and additional acceptance checks verified; PR, actual command outputs, migration/decoder version, residual limitations and license evidence in issue status log.
- Merge and verify this issue before updating EPIC #4 and marking the next item READY; keep all code/doc/UI English.
- Do not claim GitHub CI passed if the Actions runner did not run.


---

## 38. [#42] Implement and validate SATCOM observations through the decoder registry

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/42  
**Phase:** Stage 6 · Advanced domains  
**Snapshot status:** BACKLOG · **Dependency:** Issue #41 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 38 · **Stage:** 6 — Advanced aviation domains · **Status:** BACKLOG
> **Sequential prerequisite:** #41 closed DONE with merged PR and verification.

### Objective
Authorized SATCOM messages, where available, are ingested with accurate provenance and explicit limitations.

### Exact implementation requirements
1. Select and document a legally accessible SATCOM message level; fail closed if no authorized source is available.
2. Define source-specific versioned mapping to bearer, application layer, timestamp, direction and actual identifiable aircraft role.
3. Do not fabricate satellite frame payloads, receiver locations or protected message content from a provider summary.
4. Apply publication entitlements, redaction and privacy controls before any UI exposure.
5. Document limits of available coverage; integrate parser errors/retries through existing source consumer.

### Target ownership / locations
`communications/infrastructure/decoders/satcom`, contract and integration fixtures.

### Verification to execute
- Authorized redacted fixture happy path, malformed payload, unknown aircraft, missing RF payload and private content.
- Real PostgreSQL provenance and publication isolation tests.

### Definition of done — task-specific
- Supported SATCOM observations preserve correct source/data level and policy.
- No unauthorized content is exposed or stored outside approved scope.
- Failure to obtain rights is reported BLOCKED rather than simulated as success.
- Merged PR, local and remote CI status, actual test evidence and limitations recorded; epic updated.

### Non-goals
No proprietary satellite signal demodulator.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Read before coding

Inspect `AGENTS.md`, `docs/ROADMAP.md`, `docs/architecture/ARCHITECTURE_V2.md`, the immediate predecessor's PR and code anchors: protocol registry #39, entitlements #25, privacy-safe projections #28.

#### New modules / exact ownership

Proposed files: modules/communications/infrastructure/decoders/satcom/. Create these paths only if absent; existing Stage2 context does NOT already implement this feature. Export narrow public API; do not bypass architecture checker.

#### Explicit contract and invariants

SATCOM observation may be provider message only; no fabricated satellite frame/station. Rights and field masks apply to each representation.

#### Implementation algorithm, failure and test cases

Block without rights/authorized samples; parse real permitted source shape; document limitation of data level. Test private vs allowed, bad payload, unknown aircraft.

#### Execution protocol for an implementation agent

1. Verify previous issue DONE with merged PR; update this issue body to IN PROGRESS with UTC date, branch, owner, planned files and blockers.

2. Add validated data types and pure policy tests, then smallest application use case, narrow ports, adapters, composition root, contract tests and persistence migration if needed. Do not implement later issues in the same PR.

3. Verify unusual timing, unknown metadata, repeat deliveries, authorization and revision races. Run `npm run check`; real PG integration for SQL; E2E for UI/WS; record command/result, including remote CI separately.

4. Change issue status to IN REVIEW with PR, update checked criteria only after actual proof and record architecture impact, migrations, rollback and limits. After merge set DONE/close and update EPIC #4 counts plus successor READY.

5. Missing licensing/decoder samples must be reported as BLOCKED with exact permission owner/action, never substituted with artificial data advertised as live.

### Agent implementation blueprint (2026-11-19)

> **Code baseline:** Stage2 `main@373a2755`; contracts from predecessor issues must be read from actual merged code. Proposed files below are not implemented yet. Follow English-only rule and single active issue sequence.

#### Existing code and dependency artifacts
- `Stage6 #39 decoder registry and #36 fragment contracts`
- `Stage3 approved source/provenance data levels and Stage5 entitlements`
- `Stage6 #41 HFDL extension and decoder contract test approach`
- `docs/DECODER_CONTRACT.md`

#### Concrete file/module ownership
- `packages/backend/src/modules/communications/infrastructure/decoders/satcom/{decode-satcom.ts,map-satcom-fields.ts,register.ts}`
- `packages/backend/tests/fixtures/decoders/satcom/README.md`
- `packages/backend/tests/satcom-decoder.test.mjs`
- `packages/backend/tests/integration/satcom-source-import.test.mjs`
- `docs/SATCOM_SOURCE_LIMITS.md`

#### Typed endpoint, event or metric contract
1. SATCOM observation must declare actual source and data level (`PROVIDER_MESSAGE`, genuine frame or reception), bearer `SATCOM`, application protocol only if verified, time source and direction; do not fabricate a satellite frame or receiver.
2. Represent `SUPPORTED`, `UNSUPPORTED_VARIANT`, `PRIVATE_OR_WITHHELD` and `MALFORMED` separately. If source terms disallow content storage, persist only allowed metadata and reject disallowed payload before DB write.
3. Source/account entitlement may prohibit redistribution even when a connected provider returns the payload; publication policy is mandatory.

#### Work steps
- **Step 1.** Find an authorized SATCOM provider/decoder and record its exact licensed input-level schema, allowed storage/redistribution and redacted fixture review date. If unavailable mark BLOCKED.
- **Step 2.** Create decoder-specific validator and pure field mapping with protocol/version and participant-role checks, preserving observed time uncertainty.
- **Step 3.** Register through #39 without central switch changes; never attempt closed/proprietary satellite demodulation.
- **Step 4.** Route parsed complete permitted messages to durable private import; route real supported fragments to #36 only if protocol semantics justify it.
- **Step 5.** Add source capability and health qualifiers, privacy/withholding tests, and document what the adapter does not decode.

#### Regression/failure verification
- Golden permitted fixture of complete message, metadata-only provider payload, malformed/unknown variant and absent RF bytes.
- Source-only decoded message creates no invented station or frame; no private text or exact location leaked in public response.
- Real database replay/idempotency, independent time quality and a publication-denied scenario.
- Fail this issue's completion if rights/sample are absent — don't substitute mock bytes as verified live SATCOM integration.

#### Explicit ownership boundary
After this task, multiple protocol adapters are supported only for documented data levels. History/search is #43 and production release gates follow.

#### Issue completion evidence
- All original acceptance checks and these steps verified with actual results; link merged PR SHA and documented limitations, source rights and rollback/migration impact.
- Set this issue to DONE only after accepted merge, update EPIC #4 progress and make just the next issue READY.
- Differentiate local verification from any GitHub Actions run that was blocked or skipped.


---

## 39. [#43] Add bounded history search and cursor pagination across flight/messages

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/43  
**Phase:** Stage 6 · Advanced domains  
**Snapshot status:** BACKLOG · **Dependency:** Issue #42 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 39 · **Stage:** 6 — Advanced aviation domains · **Status:** BACKLOG
> **Sequential prerequisite:** #42 closed DONE with merged PR and verification.

### Objective
Users can inspect older communication and observed track history without truncation masquerading as a complete result.

### Exact implementation requirements
1. Implement keyset pagination bound to scope, filter fingerprint and deterministic sort (`observedAt,id,revision`), with opaque cursors.
2. Add filters for aircraft/flight-session, bearer/protocol, station visibility, date window and correlation outcome.
3. Use separate projections/queries for historical messages, flight sessions and track observations; enforce authorization before counts/cursors.
4. Avoid unbounded reads, use indexed paths and expose empty/expired cursor outcomes.
5. Add history pagination UX with explicit correction/revision context and a documented retention policy.

### Target ownership / locations
`read-models/search`, history REST endpoints, indexes and UI filters.

### Verification to execute
- Thousands of synthetic rows, same timestamp ties, cursor reuse with wrong scope, revocation, deleted/retained history and reverse paging.
- Database EXPLAIN checks for key filters and UI end-to-end pagination tests.

### Definition of done — task-specific
- History can page deterministically beyond former 500-row response limit.
- An unauthorized filter cannot reveal hidden rows or counts.
- No gap/duplicate on a stable history snapshot.
- Merged PR, local and remote CI status, actual test evidence and limitations recorded; epic updated.

### Non-goals
No general free-text search over confidential payloads without explicit rights.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Read before coding

Inspect `AGENTS.md`, `docs/ROADMAP.md`, `docs/architecture/ARCHITECTURE_V2.md`, the immediate predecessor's PR and code anchors: map read model #20, communication message reader, grant projection #28.

#### New modules / exact ownership

Proposed files: modules/read-models/history-search/; apps/api/src/routing/history-*. Create these paths only if absent; existing Stage2 context does NOT already implement this feature. Export narrow public API; do not bypass architecture checker.

#### Explicit contract and invariants

History cursor bound to scope+filters+sort (observedAt,messageId,revision); APIs include limit, start/end, protocol, session and station with authorization.

#### Implementation algorithm, failure and test cases

Implement keyset pagination indexes, no global unbounded scans or counts before scope filtering; test same-time tie, 501 rows, revoked scope and cursor mismatch.

#### Execution protocol for an implementation agent

1. Verify previous issue DONE with merged PR; update this issue body to IN PROGRESS with UTC date, branch, owner, planned files and blockers.

2. Add validated data types and pure policy tests, then smallest application use case, narrow ports, adapters, composition root, contract tests and persistence migration if needed. Do not implement later issues in the same PR.

3. Verify unusual timing, unknown metadata, repeat deliveries, authorization and revision races. Run `npm run check`; real PG integration for SQL; E2E for UI/WS; record command/result, including remote CI separately.

4. Change issue status to IN REVIEW with PR, update checked criteria only after actual proof and record architecture impact, migrations, rollback and limits. After merge set DONE/close and update EPIC #4 counts plus successor READY.

5. Missing licensing/decoder samples must be reported as BLOCKED with exact permission owner/action, never substituted with artificial data advertised as live.

### Agent implementation blueprint (2026-11-19)

> **Code baseline:** Stage2 `main@373a2755`; contracts from predecessor issues must be read from actual merged code. Proposed files below are not implemented yet. Follow English-only rule and single active issue sequence.

#### Existing code and dependency artifacts
- `packages/backend/src/demo/infrastructure/postgres/postgres-message-reader.ts (existing `LIMIT 500`)`
- `Stage4 #16 position history and #19 observed-track use cases`
- `Stage5 #28 scoped message projections and #27 grants`
- `apps/api/src/routing/{route.ts,handle-request.ts} and Stage4 #23 UI`

#### Concrete file/module ownership
- `packages/backend/src/modules/read-models/domain/{history-filter.ts,history-cursor.ts}`
- `packages/backend/src/modules/read-models/application/{search-messages.ts,search-flight-sessions.ts,search-positions.ts}`
- `packages/backend/src/modules/read-models/infrastructure/postgres/history-search-reader.ts`
- `apps/api/src/routing/history-routes.ts`
- `apps/web/src/features/history-search/`
- `packages/backend/tests/integration/history-cursor.test.mjs`

#### Typed endpoint, event or metric contract
1. HTTP candidates: `GET /api/v1/aircraft/:id/messages?limit=50&cursor=...&bearer=...&from=...&to=...`, `GET /api/v1/flight-sessions/:id/messages`, `GET /api/v1/aircraft/:id/observed-track`. Return `{data, nextCursor?,asOf}` consistently with existing API error envelope.
2. Sort messages by `(observedAt DESC,messageId ASC,revision DESC)` with stable keyset predicate (careful at ties); cursor is opaque/signed and bound to principal scope, filter hash, policyEpoch and projection generation.
3. A status-only or denied observation cannot leak through counts, cursor offsets, total estimates, errors or time-range gaps. Paging must not silently truncate at the original 500-response cap.

#### Work steps
- **Step 1.** Define validated filter/time/bearer/session query DTOs and `CursorPage<T>` semantic contract; keep HTTP parsing separate from SQL query building.
- **Step 2.** Introduce indexed scoped history query(s) from Stage5 projections; implement stable keyset pagination with explicit snapshot/correction semantics and maximum page size/window.
- **Step 3.** Provide REST endpoint serialization and safe 400/404/403/410 for invalid, unknown, forbidden or expired cursor states; never silently ignore unsupported fields.
- **Step 4.** Build React history filter/pagination UI reusing shared design primitives, URL filters and message-detail components, with loading/empty/revision labels.
- **Step 5.** Document retention, effect of backfilled observations and consistent paging guarantee (snapshot version if supported; otherwise explicitly communicate that corrections can reorder results).

#### Regression/failure verification
- >500 messages and positions; identical timestamps and multiple revisions, page forward/back without duplicates/skips within stable snapshot.
- Cursor from principal/scope A reused in B; grant revoked mid-pagination; corrected message-link revision and retention expiration.
- SQL EXPLAIN/ANALYZE for key filters, bounded query budget and no global full-text search over restricted contents.
- Playwright page/filters URL roundtrip and long payload truncation.

#### Explicit ownership boundary
History is authorized and bounded; free-text searching raw private payloads requires separate source rights and is outside this issue.

#### Issue completion evidence
- All original acceptance checks and these steps verified with actual results; link merged PR SHA and documented limitations, source rights and rollback/migration impact.
- Set this issue to DONE only after accepted merge, update EPIC #4 progress and make just the next issue READY.
- Differentiate local verification from any GitHub Actions run that was blocked or skipped.


---

## 40. [#44] Instrument aviation data quality and decide scaling from measured load

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/44  
**Phase:** Stage 6 · Advanced domains  
**Snapshot status:** BACKLOG · **Dependency:** Issue #43 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Epic:** #4 · **Order:** 40 · **Stage:** 6 — Advanced aviation domains · **Status:** BACKLOG
> **Sequential prerequisite:** #43 closed DONE with merged PR and verification.

### Objective
Operations can diagnose correlation, ingestion, delivery, expiry and map lag, and scaling choices follow evidence.

### Exact implementation requirements
1. Add bounded-cardinality metrics for source lag, partial candidates, conflicts, retractions, outbox lag, quarantines, expiry overdue and map WS resync.
2. Expose structured correlation IDs and trace boundaries without including raw payloads or secrets.
3. Run repeatable load scenarios for positions per second, messages per second, aircraft per viewport and concurrent subscribers.
4. Measure DB hotspots, query latencies and worker isolation; write an ADR deciding whether NATS/Redis or separate processes are justified.
5. Add operational alerts and failure-runbook thresholds with real measured baselines.

### Target ownership / locations
`platform/observability`, dashboards/metric docs, load-test scripts and ADR.

### Verification to execute
- Metrics counters under error/retry, label-cardinality limits and log redaction.
- Reproducible load and fault tests with explicit hardware/data/limits documented.

### Definition of done — task-specific
- A dashboard and runbook can identify stalled streams and corrupted correlations.
- An evidence-based architecture decision documents scale needs.
- No unsupported performance claims are made.
- Merged PR, local and remote CI status, actual test evidence and limitations recorded; epic updated.

### Non-goals
No premature migration to microservices without an approved performance reason.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Existing code to inspect

Read event-delivery lease/retry code, the source-health contract (#12), map stream (#30), realtime gateway (#31) and AGENTS.md. This platform metrics layer is NOT implemented in Stage2.

#### New code ownership

Create packages/backend/src/modules/platform/observability, tests/performance and docs/PERFORMANCE.md. Keep domain code independent of telemetry SDK.

#### Typed metrics contract and algorithms

Expose bounded-cardinality measurements source_ingest_lag, correlation_conflict_count, queue_oldest_age, expired_leases, replay_gap_count, ws_resync_total. Use shared tags limited to source category, status or protocol; never use messageId, aircraftId or unredacted payload as metric label.

Capture p50/p95 and error budgets under explicit messages/sec, positions/sec, aircraft/viewport, users and CPU/DB assumptions. Add tracing around source receive, transaction commit, outbox fan-out, consume, projection, WS delivery. Make architectural scaling choices only after measured bottlenecks.

#### Failure and verification

Test a stalled worker, source disconnect, retries, high-cardinality injection, revoked payload redaction, late timer and slow WS client. Run npm run check and load harness; include measured results and environment in the PR. No unsupported throughput claim.

#### Workflow

Confirm #43 DONE. Update existing issue status to IN PROGRESS with date, branch, scope before coding. Implement core typed counters, lightweight adapter, tests and runbook. Record actual evidence; mark IN REVIEW with PR. After verified merge mark DONE and update EPIC #4, then activate #45. Preserve original acceptance boxes.

### Agent implementation blueprint (2026-11-19)

> **Code baseline:** Stage2 `main@373a2755`; contracts from predecessor issues must be read from actual merged code. Proposed files below are not implemented yet. Follow English-only rule and single active issue sequence.

#### Existing code and dependency artifacts
- `packages/backend/src/demo/infrastructure/delivery-worker.ts`
- `packages/backend/src/modules/event-delivery/infrastructure/{fan-out.ts,retry-delivery.ts,recover-expired.ts}`
- `Stage5 WebSocket/subscription and source health contracts`
- `docs/architecture/docs/FAILURE_MODES.md`

#### Concrete file/module ownership
- `packages/backend/src/modules/observability/{domain/metric-labels.ts,ports/metrics.ts,infrastructure/metrics-adapter.ts}`
- `scripts/load/{generate-positions.mjs,generate-messages.mjs,simulate-subscribers.mjs}`
- `docs/OPERATIONS_METRICS.md`
- `docs/adr/<next>-measured-scaling.md`

#### Typed endpoint, event or metric contract
1. Required metric families: ingest lag per source, `correlation_decisions_total{outcome,policy}`, candidate-incomplete, assignment retracts, outbox oldest age, consumer retry/quarantine, projection revision lag, WebSocket resync reason and p50/p95/p99 map latency.
2. Never label metrics with `messageId`, exact AircraftId, receiver UUID, raw payload or user token. Use bounded enum labels and trace IDs stored only in restricted structured logs.
3. Scaling ADR must record measured environment, workload, bottleneck, before/after gains and explicit decision to retain modular monolith or split a measured hotspot; no mandatory NATS/Redis absent evidence.

#### Work steps
- **Step 1.** Define metrics/trace interfaces in a transport-neutral module; adapters to monitoring library live in infrastructure or runtime composition.
- **Step 2.** Instrument Stage3 source intake, Stage2 transaction/outbox, Stage5 scoped projectors and WebSocket gateway without logging decoded radio content.
- **Step 3.** Write a deterministic synthetic workload generator with seed, ramp-up, observation distribution, allowed memory/DB limits and explicit stop conditions.
- **Step 4.** Run baseline load/soak for documented aircraft/message/position/client counts; measure p95/p99 and queue lag, PostgreSQL lock contention and worker CPU/memory.
- **Step 5.** Document alarm thresholds and diagnosis runbook, and write an ADR on measured need for separate workers, broker, Redis or database partitioning.

#### Regression/failure verification
- Metric label cardinality stays bounded under 10k unique aircraft IDs; no raw payload exposed in logs/traces.
- Injected error increments appropriate counter; retry lag and WS overflow/resync visible.
- Load baseline produces reproducible results with hardware, timestamp, query distribution and real bottleneck measurements.
- Benchmark command never touches live licensed feeds by default.

#### Explicit ownership boundary
Release qualifying stress and chaos tests are #51; this issue builds instrumentation and justifies architecture decisions.

#### Issue completion evidence
- All original acceptance checks and these steps verified with actual results; link merged PR SHA and documented limitations, source rights and rollback/migration impact.
- Set this issue to DONE only after accepted merge, update EPIC #4 progress and make just the next issue READY.
- Differentiate local verification from any GitHub Actions run that was blocked or skipped.


---

## 41. [#45] Complete an application threat model and close high-priority security gaps

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/45  
**Phase:** Release readiness (deferred)  
**Snapshot status:** BACKLOG · **Dependency:** Issue #44 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Parent epic:** #4 · **Execution order:** 41 · **Phase:** Production readiness · **Status:** BACKLOG
> **Depends on:** #44 DONE (merged and verified); no overlapping active tasks.

### Objective / one-task deliverable
Every public endpoint and feeder path is reviewed for abuse, privilege escalation, data leakage and operational exhaustion before deployment.

### Implementation and operating procedure
1. Inventory actors, trust boundaries, data sources, secrets, raw message content, public map/status derivatives, admin commands and DB roles.
2. Review authentication, authorization, SSRF, token storage, WebSocket origin/scope, CSV/log injection and endpoint-level rate/resource limits.
3. Implement mitigations for high-severity findings with isolated tests and explicit ownership; reject unsafe defaults for public bindings.
4. Configure secure headers, request limits, safe error reporting, credential rotation and redacted audit trails.
5. Document residual risks and threat-model revision tied to a release commit.

### Expected files / ownership
`docs/security/THREAT_MODEL.md`, API hardening modules, security regression tests.

### Verification plan
- Security API and WebSocket negative tests (cross-scope and unauthenticated); load abuse/resource limit tests.
- Dependency and secret scanning with any exceptions documented.

### Acceptance criteria
- No open high-severity unmitigated issue without an explicit release block.
- Security runbook documents keys, incident response, and least privilege.
- Security checks are reproducible.
- Evidence, merged PR/decision, test commands, actual CI status, risk/rollback and limitations recorded; parent #4 updated.

### Explicit boundaries
Does not itself approve external licensing rights.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Existing code / prerequisites

Read apps/api/src/routing/handle-request.ts and all merged #26 auth, #29 publication modules, AGENTS.md and docs/architecture/ARCHITECTURE_V2.md.

#### Intended ownership

Create docs/security/THREAT_MODEL.md and targeted security tests.

#### Exact contract, algorithm and negative cases

Model actors anonymous, user, feeder, provider, worker and migrator; include content, counts, colors, cursors, station positions and secrets as assets. Enumerate cross-scope/SSRF/token/DoS/payload injection attacks, severity, mitigations, owners. Implement high-severity mitigations. Test unauthorized principal, spoofed feeder, expired JWT and WS replay; no release on unmitigated high issue.

#### Execution instructions

Confirm immediate predecessor DONE and record IN PROGRESS with branch, UTC timestamp, owner and files before implementation. Define typed contract, implement one coherent function/use case at a time, add negative and recovery tests. Run npm run check, applicable real PG/browser tests and any real release drill. Keep test commands/results and CI URL accurate. Mark IN REVIEW with PR; close DONE only after merged SHA, verified tests, updated issue body and checked EPIC #4. Block on missing permissions and record unblock action.

### Agent implementation blueprint (2026-11-19)

> **Execution baseline:** Stage2 `main@373a2755` with full sequential predecessor history. Planned paths may require alignment to merged Stage3–6 packages. Security, licensing and operational acceptance are evidence-based; never record speculative approval.

#### Existing code and relevant merged outputs
- `Stage5 `access`, `publication`, realtime gateway and frontend`
- `apps/api/src/http/{read-json-body.ts,http-problem.ts,send-problem.ts}`
- `apps/api/src/create-api-server.ts, runtime config/shutdown`
- `db/migrations and prior security tests`

#### Files / executable artifacts to produce
- `docs/security/THREAT_MODEL.md, docs/security/SECURITY_RUNBOOK.md`
- `apps/api/src/http/<narrow-security-middleware>.ts only for verified gaps`
- `packages/backend/tests/security/ and apps/api/tests/security/`
- `docs/IMPLEMENTATION_STATUS.md security audit evidence`

#### Required operational data contracts and invariants
1. Threat-model table for each asset (`source token`, `feeder credential`, `decoded payload`, `station precise location`, `scope policy epoch`, `public marker/count`, `WS cursor`) with threat actor, entry point, impact, mitigation owner and validation test.
2. Define intended auth boundaries for anonymous/public, authorized owner, feeder, operator and migrator; verify no endpoint takes a user-supplied effective scope or claims safe publication based on authentication alone.
3. Set explicit ingress budgets for JSON body, query limits, subscriptions, cursor age, request concurrency and oversized protocol frames. Invalid inputs return sanitized 4xx and never raw database errors or source payloads.

#### Agent implementation procedure
- **Step 1.** Inventory route, WS, transport/feeder, storage and deployment entry points with a data-flow diagram; enumerate trust boundaries and privileges.
- **Step 2.** Perform focused risk assessment for credential injection, API token leakage, SSRF via tile/provider endpoint, WebSocket origin/cross-scope, XSS/message text, denial of service, CSV/log injection, SQL and cache key scope leaks.
- **Step 3.** For each HIGH finding, add a minimal fix in its owning module with a regression test. Do not create a vague cross-cutting `SecurityManager` bypassing SRP.
- **Step 4.** Add defense-in-depth response headers, timeouts, size ceilings, secret redaction and audit logging only where needed; preserve Stage2 localhost demo behavior where explicitly configured.
- **Step 5.** Create runbook for token revocation, emergency source pause, private-message takedown, alarm escalation and documented residual risks.

#### Concrete test/evidence cases
- Unauthenticated external request cannot reach real feed, untrusted origin cannot subscribe WS, revoked scope cannot resume cursor.
- Malicious decoded text renders as safe React text; input over budget rejected before DB allocation.
- Source secret not logged in HTTP errors, metrics, CI artifacts, exceptions, stack traces or browser bundle.
- Document all high findings resolved or specific release blocker, with actual tests and reviewer sign-off.

#### Gate boundary
This is security hardening, not a substitute for the separate data-rights approval in #46.

#### Completion record / evidence
- Update original acceptance criteria and this body with audited owner/sign-off, actual test outputs, verified PR/commit, limitations and rollback.
- If an external dependency cannot be resolved, mark BLOCKED with exact unblock condition, keep EPIC #4 incomplete and do not start successor.
- Keep English project text and distinguish actual remote CI from local checks; update parent checkbox only on verified DONE.


---

## 42. [#46] Approve data licenses, privacy handling and source takedown workflow

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/46  
**Phase:** Release readiness (deferred)  
**Snapshot status:** BACKLOG · **Dependency:** Issue #45 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Parent epic:** #4 · **Execution order:** 42 · **Phase:** Production readiness · **Status:** BACKLOG
> **Depends on:** #45 DONE (merged and verified); no overlapping active tasks.

### Objective / one-task deliverable
Every public aviation data product has documented redistribution permissions and a way to revoke it safely.

### Implementation and operating procedure
1. Create a per-source rights register with access agreement, allowed data level, public display fields, receiver location rules and expiry/review owner.
2. Verify ADS-B position tile/map data licenses independently of communication/decoded frame rights; don't treat source API availability as permission.
3. Define an intake and urgent takedown process that revokes grants, invalidates caching and updates published projections.
4. Document privacy minimization for identifiers, decoder content, station details, telemetry, backups and support logs.
5. Review real-source samples and consent/permissions with the data owner or legal reviewer; record explicit go/no-go and unresolved restrictions.

### Expected files / ownership
`docs/governance/{DATA_RIGHTS,TAKEDOWN,PRIVACY}.md`, publication governance configuration.

### Verification plan
- Tabletop source grant withdrawal and end-to-end hidden-result test from map/API/WS.
- Documentation check for source provenance, review date and responsible approver.

### Acceptance criteria
- Every published source/surface has a current rights and privacy decision.
- Takedown is executable through tested interfaces.
- Missing rights block release instead of being silently assumed.
- Evidence, merged PR/decision, test commands, actual CI status, risk/rollback and limitations recorded; parent #4 updated.

### Explicit boundaries
Does not implement independent retention migrations, handled next.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Existing code / prerequisites

Read #6 verified source rights ADR, publication policy #25 and station privacy #38.

#### Intended ownership

Create docs/governance/DATA_RIGHTS.md, PRIVACY.md, TAKEDOWN.md and related policy tests.

#### Exact contract, algorithm and negative cases

Per-source field/dataLevel matrix with permissions for ingest, storage and redistribution, reviewer/date, retention and geographic privacy. A provider API existing is not publication permission; unknown rights block release. Verify actual takedown → grant revoke → no content/count/color/cursor leakage.

#### Execution instructions

Confirm immediate predecessor DONE and record IN PROGRESS with branch, UTC timestamp, owner and files before implementation. Define typed contract, implement one coherent function/use case at a time, add negative and recovery tests. Run npm run check, applicable real PG/browser tests and any real release drill. Keep test commands/results and CI URL accurate. Mark IN REVIEW with PR; close DONE only after merged SHA, verified tests, updated issue body and checked EPIC #4. Block on missing permissions and record unblock action.

### Agent implementation blueprint (2026-11-19)

> **Execution baseline:** Stage2 `main@373a2755` with full sequential predecessor history. Planned paths may require alignment to merged Stage3–6 packages. Security, licensing and operational acceptance are evidence-based; never record speculative approval.

#### Existing code and relevant merged outputs
- `Stage3 #6 approved provider rights ADR`
- `Stage4 #15 ADS-B source and map tile provider rights`
- `Stage5 #25 entitlement and #29 revocation contracts`
- `docs/SOURCES.md, docs/PUBLICATION_POLICY.md`

#### Files / executable artifacts to produce
- `docs/governance/{SOURCE_RIGHTS_REGISTER.md,PRIVACY.md,TAKEDOWN.md}`
- `scripts/governance/validate-rights-register.mjs (pure metadata checker)`
- `tests/e2e/source-revocation.spec.ts`
- `docs/IMPLEMENTATION_STATUS.md release-governance gate`

#### Required operational data contracts and invariants
1. Rights register fields per upstream: provider, account/contract, exact permitted data level (`providerMessage`, `frame`, `reception`, position, tile), purpose, territories, retention, public display rights, attribution, last review date, approver, expiration and revocation contact.
2. Declare separate permissions for message text, metadata/decoded summary, position, derived counts/freshness, precise station locations, raw frame bytes and data exports. A right to receive content is not permission to redistribute it.
3. Document actionable takedown sequence `revoke grant → stop connector/source credentials → invalidate scoped API/WS caches/cursors → retract contributions → verify no public exposure → audit`, while acknowledging previously delivered data cannot be recalled.

#### Agent implementation procedure
- **Step 1.** Collect official provider terms and account agreement evidence for every actual connected source and tile service, with current URLs and review date; do not guess licenses.
- **Step 2.** Produce per-field/source matrix with APPROVED_PRIVATE_ONLY, APPROVED_PUBLIC or BLOCKED states, required attribution and proof-of-authority reviewer.
- **Step 3.** Implement a machine-readable release rights register with validation of mandatory fields, expiration and missing approvals; no raw contracts with personal secrets in repo.
- **Step 4.** Run an end-to-end source takedown exercise through Stage5 grants and source disable; verify message contents, counts, colors, history and station details stop leaking.
- **Step 5.** Document PII/sensitive comms handling, station owner precision controls, backups/log retention and data owner escalation. Require explicit accountable sign-off.

#### Concrete test/evidence cases
- Missing field rights denies data even if source transport works; expiration/revocation updates public UI/API/WS.
- Proof that public counts/freshness/status do not include a private source; license check for base map tiles and attribution.
- Review approvals/term dates and redacted audit evidence; no legal claim beyond actually reviewed sources.
- If rights remain unresolved, mark BLOCKED and stop production release.

#### Gate boundary
Do not complete this task by writing a document with unchecked providers; actual rights verification is required. Retention execution belongs to #47.

#### Completion record / evidence
- Update original acceptance criteria and this body with audited owner/sign-off, actual test outputs, verified PR/commit, limitations and rollback.
- If an external dependency cannot be resolved, mark BLOCKED with exact unblock condition, keep EPIC #4 incomplete and do not start successor.
- Keep English project text and distinguish actual remote CI from local checks; update parent checkbox only on verified DONE.


---

## 43. [#47] Implement audited retention, export and deletion lifecycle for stored data

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/47  
**Phase:** Release readiness (deferred)  
**Snapshot status:** BACKLOG · **Dependency:** Issue #46 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Parent epic:** #4 · **Execution order:** 43 · **Phase:** Production readiness · **Status:** BACKLOG
> **Depends on:** #46 DONE (merged and verified); no overlapping active tasks.

### Objective / one-task deliverable
Persisted source deliveries, raw/decoded messages, positions, revisions, logs and payloads have enforceable lifecycle policies.

### Implementation and operating procedure
1. Define per-category retention and rights rules, including required audit/outbox/replay horizons and legally mandated preservation exceptions.
2. Implement bounded batch archive/purge jobs with dry-run, progress cursor, ownership restrictions, quota and operator diagnostics.
3. Withdraw or rebuild projections before removing authoritative data so old status/counts cannot survive by accident.
4. Define safe export and deletion actions for station owners where appropriate; redact confidential payloads in exports.
5. Test archival/restore and deletion interaction with tombstones, idempotency, streaming cursors and backups.

### Expected files / ownership
`platform/data-lifecycle`, retention migrations/jobs, `docs/RETENTION.md`.

### Verification plan
- Retention boundary and partial failure tests with real PostgreSQL, including restart and idempotent repeats.
- Source rights revocation after data export; cross-scope leakage and expired-cursor tests.

### Acceptance criteria
- Retention policies are executable and audited, not merely documented.
- Deletion does not create false freshness or resurrect previously hidden content.
- All runbooks and tests reflect actual policy.
- Evidence, merged PR/decision, test commands, actual CI status, risk/rollback and limitations recorded; parent #4 updated.

### Explicit boundaries
Backup disaster-recovery runbook is a separate task.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Inspect existing modules and previous issue evidence

Read db/migrations, modules/message-availability/infrastructure/postgres-contribution-writer.ts, source deliveries #7, history search #43 and rights #46.

#### Files to create or modify

modules/platform/data-lifecycle and docs/RETENTION.md; additive migration only.

#### Exact expected behavior, edge cases and tests

Retention is per source delivery, reception, frame occurrence, decoded message, position, outbox/inbox, logs, grants, tombstone and backups. Implement resumable bounded dry-run/purge with audit and least privilege. Keep old projection/replay cursors invalid on removal; ensure tombstones survive replay window. Test failed mid-batch, restart, rights revoke, restore and deletion of previously latest message.

#### Agent runbook

Verify preceding issue is DONE and merged. Update original status to IN PROGRESS with owner, branch, date and files; implement typed contracts before operational adapters, with negative/failure tests. Run npm run check and actual PostgreSQL/Playwright/restore drills as relevant. Record exact pass/fail numbers, environment, GitHub Actions status, secrets/data-rights review and rollback notes; no invented proof. On review link focused PR and set IN REVIEW, then after verified merge set DONE/close, check epic #4 and activate successor. External blockers are BLOCKED with explicit owner/action.

### Agent implementation blueprint (2026-11-19)

> **Execution baseline:** Stage2 `main@373a2755` with full sequential predecessor history. Planned paths may require alignment to merged Stage3–6 packages. Security, licensing and operational acceptance are evidence-based; never record speculative approval.

#### Existing code and relevant merged outputs
- `Stage3 source-delivery / message provenance tables and Stage4 position history`
- `Stage5 scope grants, tombstone revisions and map change log`
- `packages/backend/src/modules/event-delivery/infrastructure/{fan-out.ts,consume-event.ts}`
- `scripts/postgres/migrate.mjs`

#### Files / executable artifacts to produce
- `packages/backend/src/modules/data-lifecycle/{domain/retention-policy.ts,application/plan-expiry.ts,ports/retention-writer.ts}`
- `packages/backend/src/modules/data-lifecycle/infrastructure/postgres/`
- `db/migrations/<next>_retention_jobs.sql`
- `scripts/retention/{plan.mjs,apply.mjs}`
- `docs/RETENTION.md + database integration tests`

#### Required operational data contracts and invariants
1. Retention policy is per record class/source/scope: raw payload, decoded message, provenance, position, access grant, outbox/inbox, tombstone, WS change log, audit and backup. Each has TTL, lawful basis and required minimum replay horizon.
2. Retention jobs use explicit bounded batch size, dry-run, checkpoint cursor, policy version and operator identity. `DELETE` privileges are granted only to a tightly scoped lifecycle worker, not the normal API runtime.
3. Never purge authoritative event/permission tombstones before the maximum supported replay and consumer redelivery horizon. Purged item references require final cleanup of projections, caches and source indexes.

#### Agent implementation procedure
- **Step 1.** Write rights-derived retention matrix and default-deny semantics for records without a valid policy; do not choose deletion timelines without recorded decision.
- **Step 2.** Implement pure `isEligibleForExpiry(record,policy,now)` and `planRetentionBatch`, excluding legal holds and pending outbox/inbox work.
- **Step 3.** Add privileged lifecycle adapter with transactionally fenced claim, delete/archive and audit; use schema-owner grants and no unsafe broad SQL in API process.
- **Step 4.** Before purging, retract public contributions and invalidate/version projection generation and old WS/history cursors; preserve necessary audit/tombstone evidence.
- **Step 5.** Test partial failures and worker restart; provide safe operator dry-run/preview and reapply commands, with maximum rows/time quotas.

#### Concrete test/evidence cases
- Dry-run leaves data untouched; actual expire at boundary; hold/pending delivery prevents deletion.
- After erasure, no stale green/count, old cursor or message detail resurrects data; source has no orphan refs.
- Abort during batch retries safely; snapshot/backup retention reconciled; scoped grants prevent ordinary runtime deleting.
- Real PostgreSQL integration tests, documented recovery and sample execution summary.

#### Gate boundary
Backups/disaster restoration are #48; retention must be coordinated with restore procedures before launching.

#### Completion record / evidence
- Update original acceptance criteria and this body with audited owner/sign-off, actual test outputs, verified PR/commit, limitations and rollback.
- If an external dependency cannot be resolved, mark BLOCKED with exact unblock condition, keep EPIC #4 incomplete and do not start successor.
- Keep English project text and distinguish actual remote CI from local checks; update parent checkbox only on verified DONE.


---

## 44. [#48] Implement and drill PostgreSQL backup, recovery and migration rollback

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/48  
**Phase:** Release readiness (deferred)  
**Snapshot status:** BACKLOG · **Dependency:** Issue #47 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** Build one complete code slice with local verification, review, merge and issue-body progress.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Parent epic:** #4 · **Execution order:** 44 · **Phase:** Production readiness · **Status:** BACKLOG
> **Depends on:** #47 DONE (merged and verified); no overlapping active tasks.

### Objective / one-task deliverable
Operators can recover a failed deployment or database restore without guessing recovery point or losing data silently.

### Implementation and operating procedure
1. Define RPO/RTO target and backup encryption/retention/location for PostgreSQL and any immutable payload storage.
2. Implement tested backup and point-in-time recovery or documented snapshot restore on a disposable environment.
3. Verify migrations checksum and expand/contract compatibility; support rolling back application code without destructive schema rollback.
4. Exercise corrupted backup, interrupted migration, outbox relay recovery and replay after restoring a checkpoint.
5. Create an operator runbook with exact commands, credential requirements, integrity verification and no live secrets in repository.

### Expected files / ownership
`ops/backup`, `ops/recovery`, migration safety checks and documentation.

### Verification plan
- Automated restore smoke: message/decision/outbox/inbox consistency and cross-context replay correctness.
- Disaster drill notes record observed RPO/RTO and limitations.

### Acceptance criteria
- At least one real restore has been verified, not inferred from backup creation.
- Migration rollback/backward compatibility is demonstrated.
- Recovery runbook is complete.
- Evidence, merged PR/decision, test commands, actual CI status, risk/rollback and limitations recorded; parent #4 updated.

### Explicit boundaries
No production rollout until CI/deployment gates are verified.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Inspect existing modules and previous issue evidence

Read scripts/postgres/migrate.mjs, docs/POSTGRES.md, existing delivery/outbox code, retention #47.

#### Files to create or modify

ops/backup, ops/recovery, docs/RECOVERY.md, isolated restore test.

#### Exact expected behavior, edge cases and tests

Define RPO/RTO and encrypted backup retention; restore actual PostgreSQL to disposable environment, verify checksums, messages, decision heads, outbox, inbox and contributions, replay after restore without duplicates. Test corrupted archive, interrupted migration and application downgrade compatibility. Report observed recovery timings, not aspirational claims.

#### Agent runbook

Verify preceding issue is DONE and merged. Update original status to IN PROGRESS with owner, branch, date and files; implement typed contracts before operational adapters, with negative/failure tests. Run npm run check and actual PostgreSQL/Playwright/restore drills as relevant. Record exact pass/fail numbers, environment, GitHub Actions status, secrets/data-rights review and rollback notes; no invented proof. On review link focused PR and set IN REVIEW, then after verified merge set DONE/close, check epic #4 and activate successor. External blockers are BLOCKED with explicit owner/action.

### Agent implementation blueprint (2026-11-19)

> **Execution baseline:** Stage2 `main@373a2755` with full sequential predecessor history. Planned paths may require alignment to merged Stage3–6 packages. Security, licensing and operational acceptance are evidence-based; never record speculative approval.

#### Existing code and relevant merged outputs
- `docs/POSTGRES.md and db/migrations/README.md`
- `scripts/postgres/migrate.mjs checksum/advisory-lock logic`
- `packages/backend/tests/integration/durable-tracker.test.mjs`
- `Stage5 scoped grants and retained event-delivery history`

#### Files / executable artifacts to produce
- `ops/backup/{backup.sh,verify-backup.sh}`
- `ops/recovery/{restore-test.sh,verify-restored-state.mjs}`
- `docs/RECOVERY.md, docs/MIGRATION_ROLLBACK.md`
- `tests/integration/recovery-drill.test.mjs (where sandbox permits)`

#### Required operational data contracts and invariants
1. Define explicit RPO/RTO SLO proposal for release review (e.g. baseline RPO ≤ 15 min, RTO ≤ 60 min **only if backup strategy and drill prove it**). Record actual measured recovery point/time, DB and payload storage versions.
2. Backups must include necessary PostgreSQL state (all schema owners, grants, outbox/inbox, grant history), immutable payload blobs, and secrets/config recovery **references**, not plaintext credentials inside archives.
3. An application rollback must use expand/contract migrations; never edit applied 001 or rewrite migration checksums and never assume destructive SQL rollback is safe.

#### Agent implementation procedure
- **Step 1.** Choose a concrete backup strategy suited to deployment (PITR/WAL archival or verified scheduled snapshots) and document encryption, access control, retention, off-site storage and restore prerequisites.
- **Step 2.** Create reproducible scripts for taking and verifying a backup in a disposable setup, with cryptographic integrity and failure-on-missing-file checks.
- **Step 3.** Restore to a fresh isolated database, verify migrations/roles, then resume event consumers with inbox dedup; compare source message facts, revisions, grants, lastMessageAt and outbox delivery state.
- **Step 4.** Simulate interrupted migration, stale app version and failed restoration. Document how to roll back binaries/feature flags without rolling back immutable schema.
- **Step 5.** Record recovery drill timestamps, data checksums, achieved RPO/RTO, limitations, primary on-call and emergency restoration commands.

#### Concrete test/evidence cases
- Restore stage data from checkpoint; verify message/decision/outbox/inbox + private grant and status remain coherent.
- Post-restore duplicate delivery applies exactly once and previously revoked grant remains revoked.
- Backup corruption or missing WAL causes explicit failed drill; application version rollback tested against migration.
- Use actual PostgreSQL binaries; never claim PITR tested if only a logical dump was restored.

#### Gate boundary
Do not declare production-ready without measured successful restore. #49 enforces remote CI gate and #50 staging deploy.

#### Completion record / evidence
- Update original acceptance criteria and this body with audited owner/sign-off, actual test outputs, verified PR/commit, limitations and rollback.
- If an external dependency cannot be resolved, mark BLOCKED with exact unblock condition, keep EPIC #4 incomplete and do not start successor.
- Keep English project text and distinguish actual remote CI from local checks; update parent checkbox only on verified DONE.


---

## 45. [#49] Restore GitHub Actions and require passing CI as a merge/release gate

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/49  
**Phase:** Release readiness (deferred)  
**Snapshot status:** BACKLOG · **Dependency:** Issue #48 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** DEFER until final production wave. Preserve full specification below.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Parent epic:** #4 · **Execution order:** 45 · **Phase:** Production readiness · **Status:** BACKLOG
> **Depends on:** #48 DONE (merged and verified); no overlapping active tasks.

### Objective / one-task deliverable
CI runs actual TypeScript, architecture, PostgreSQL integration and browser/security tests before production release.

### Implementation and operating procedure
1. Resolve the external account billing/Actions runner block with repository owner; do not claim passing CI until a job actually runs.
2. Verify pinned Actions versions, minimal permissions, real PostgreSQL service, frontend browser setup and full test commands from fresh checkout.
3. Make workflow publish redacted artifacts and fail on skipped DB/E2E tests, lint/typing/regression and secret scanning.
4. Document branch protection/ruleset required checks and ensure releases cannot proceed on missing/red CI; configure where permissions allow.
5. Record a successful specific run SHA/URL and verify PR gate behavior with a deliberately failing test on a temporary branch.

### Expected files / ownership
`.github/workflows`, branch protection/ruleset notes, `docs/CI.md`.

### Verification plan
- Real remote GitHub Actions success on a fresh PR and intentional failure proving the gate works.
- Cross-check local and remote test matrix without unreviewed skipping.

### Acceptance criteria
- External billing block is resolved and runner executes all mandatory jobs.
- Required checks are enforced for protected release branch or exact remaining manual configuration is documented as BLOCKED.
- No successful CI claims rely solely on local tests.
- Evidence, merged PR/decision, test commands, actual CI status, risk/rollback and limitations recorded; parent #4 updated.

### Explicit boundaries
Cannot modify account billing on the user's behalf; mark BLOCKED if owner action is required.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Inspect existing modules and previous issue evidence

Read .github/workflows/ci.yml, AGENTS.md and historical GitHub Actions pre-job billing failure evidence.

#### Files to create or modify

docs/CI.md, upgraded workflow and branch rulesets.

#### Exact expected behavior, edge cases and tests

Owner must first resolve GitHub billing/Actions runner failure. Fresh PR workflow must execute strict TS+boundaries, real PG tests, browser E2E, security scanning; no silent skips. Require passing checks for merge/release and demonstrate failing test prevents merge. Record actual run SHA, logs and branch permission configuration. Missing admin permission/billing must keep BLOCKED.

#### Agent runbook

Verify preceding issue is DONE and merged. Update original status to IN PROGRESS with owner, branch, date and files; implement typed contracts before operational adapters, with negative/failure tests. Run npm run check and actual PostgreSQL/Playwright/restore drills as relevant. Record exact pass/fail numbers, environment, GitHub Actions status, secrets/data-rights review and rollback notes; no invented proof. On review link focused PR and set IN REVIEW, then after verified merge set DONE/close, check epic #4 and activate successor. External blockers are BLOCKED with explicit owner/action.

### Agent implementation blueprint (2026-11-19)

> **Run this only after #48 is DONE and EPIC #4 makes this issue READY.** Stage2 base `main@373a2755` is historical; all intervening merged changes must be inspected. Every file path below is a proposed artifact, not proof of completed implementation.

#### Read existing and predecessor evidence
- `.github/workflows/ci.yml`
- `package.json root check/test integration scripts`
- `scripts/postgres/run-integration.mjs`
- `AGENTS.md and Stage5 frontend/browser test commands`
- `Latest GitHub Actions failed run (job had no executed steps)`

#### File-level execution artifacts
- `.github/workflows/{ci.yml,release.yml} as needed (do not weaken existing checks)`
- `docs/CI_GATES.md`
- `scripts/ci/assert-required-checks.mjs (if applicable)`
- `branch protection/ruleset configuration record in docs`

#### Concrete gates / operational contracts
1. Required remote checks cover Node24 locked install + strict TS/architecture, database-independent tests, real PostgreSQL integration (no skipped tests), frontend type/build/browser E2E, scoped publication/realtime security E2E and secret/dependency scan.
2. `PASS` means GitHub Actions runner actually executed and finished green for exact PR head SHA, not a local PASS, missing check, skipped integration or billing/runner failure. Store run URL, commit SHA, job step list and outcome.
3. Merge rules require no unreviewed bypass; if the connector lacks permission to manage branch protections, provide exact UI/API configuration steps to repository owner and keep issue BLOCKED until verified.

#### Agent procedure in order
- **Step 1.** Identify why existing Actions workflow jobs fail before first step. If billing-related, request owner to fix account billing/runner availability; do not touch billing or pretend a YAML fix solves it.
- **Step 2.** Review versions/pinned `actions/checkout`, `setup-node`, PostgreSQL service and test setup; ensure `npm ci` can access locked dependencies and node 24.
- **Step 3.** Add required frontend/security/DB test jobs with service startup, fail-fast on missing DB and redacted artifacts. Enforce test timeouts and permissions as least privilege.
- **Step 4.** Configure protection/ruleset for main/release branch with named required jobs and review policy (or document exact owner action where connector has no admin scope).
- **Step 5.** Run green CI on the exact PR SHA and a deliberately failing temporary PR proving the gate blocks merge; record both evidence URLs and fix test cleanup.

#### Required demonstrable tests
- Fresh-checkout remote workflow includes real PostgreSQL and browser tests; no skipped tests and no database credentials disclosed in logs.
- Required check name matches ruleset; a failing commit cannot merge, a successful reviewed commit can.
- Actions failed before execution is explicitly documented as BLOCKED; no local test presented as remote PASS.

#### Safety and task boundary
This issue requires account owner action if billing persists. Do not advance to staging release under a missing mandatory CI gate.

#### Acceptance evidence that must be written into THIS issue
- Check original and new acceptance boxes only after real verification; link specific PR, merge SHA, runbook, operator approval, actual test/CI outputs and rollback plan.
- Mark BLOCKED if external rights/Actions/admin permission cannot be verified; never record a pass without evidence or skip required predecessor.
- On DONE close issue, check it in EPIC #4 and update progress; keep all authored issue, code, docs and release text English.


---

## 46. [#50] Provision staging deployment with health, secrets and safe rollback

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/50  
**Phase:** Release readiness (deferred)  
**Snapshot status:** BACKLOG · **Dependency:** Issue #49 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** DEFER until final production wave. Preserve full specification below.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Parent epic:** #4 · **Execution order:** 46 · **Phase:** Production readiness · **Status:** BACKLOG
> **Depends on:** #49 DONE (merged and verified); no overlapping active tasks.

### Objective / one-task deliverable
A repeatable staging environment deploys API, worker, database, and frontend without exposing restricted feeds or runtime credentials.

### Implementation and operating procedure
1. Define staging network and least-privilege identities for API, workers, migrator, source connectors, web frontend and database.
2. Build reproducible release artifacts and deploy from a specific reviewed commit; inject secrets through environment/secret manager.
3. Run migrations as a separate privileged deployment step, then start services and verify readiness including worker/outbox lag.
4. Implement canary/rollback preserving backwards compatible database schema, disabling a broken connector without losing durable deliveries.
5. Require source rights and data visibility policy approved for the staging scope; no anonymous real message endpoint.

### Expected files / ownership
`deploy/`, `docs/DEPLOYMENT.md`, staging environment configuration.

### Verification plan
- Deployment smoke: restart, version report, connection errors, rollbacks, synthetic health and safe service shutdown.
- No secrets in images, action logs, client JS bundles or dashboards.

### Acceptance criteria
- Staging can deploy and roll back a pinned revision repeatably.
- Readiness reports actual dependency state and worker health.
- Runbook records exact environment and rollback steps.
- Evidence, merged PR/decision, test commands, actual CI status, risk/rollback and limitations recorded; parent #4 updated.

### Explicit boundaries
Not a public release or a capacity certification.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Existing code to inspect

compose.yaml; docs/POSTGRES.md; apps/api/src/runtime/shutdown.ts; auth #26 and CI #49.

#### Owned new modules and configuration

deploy/staging and docs/DEPLOYMENT.md; credentials managed outside git.

#### Exact deliverable, algorithm and failure tests

Provision staging for API, worker, web and selected source connectors, separate migration login from runtime with explicit network boundaries. Deploy pinned commit; migrate separately, wait for DB/worker readiness, smoke status/availability, shut down and roll back while preserving outbox/replay. Test source and DB outage and ensure no secrets or restricted message payloads in frontend/logs.

#### Agent execution handoff

Confirm predecessor DONE and merged. Before code, edit same issue status to IN PROGRESS with owner, UTC timestamp, branch, files and missing permissions. Implement smallest complete deliverable, add reproducible negative tests and record real commands/env/results. Never assume real CI is green. Update IN REVIEW with focused PR and checklist, then DONE only after merged SHA, evidence and rollback notes; update EPIC #4 checkbox/count and activate next issue. Permission, rights or unmet SLO means BLOCKED with clear unblock action.

### Agent implementation blueprint (2026-11-19)

> **Run this only after #49 is DONE and EPIC #4 makes this issue READY.** Stage2 base `main@373a2755` is historical; all intervening merged changes must be inspected. Every file path below is a proposed artifact, not proof of completed implementation.

#### Read existing and predecessor evidence
- `docs/POSTGRES.md and db/migrations/README.md`
- `apps/api/src/runtime/{storage-config.ts,create-api-runtime.ts,shutdown.ts}`
- `Stage5 source/user roles, publication and WS`
- `Stage49 verified remote CI and release protection`

#### File-level execution artifacts
- `deploy/staging/{compose.yaml,service-config/,secrets-reference.md} or managed deployment manifests with documented choice`
- `deploy/scripts/{migrate.sh,deploy.sh,rollback.sh,smoke.sh}`
- `docs/DEPLOYMENT.md`
- `tests/e2e/staging-smoke.spec.ts`

#### Concrete gates / operational contracts
1. Staging identity separation: migrator has schema/role privileges; API, feeder worker, source worker, realtime gateway and frontend each run with least-privileged credentials. Keep secrets outside Git/compiled JS/logs.
2. Release manifest identifies exact Git commit/image digest, database schema version, source adapter versions and public-rights policy version. Migrations run as a controlled one-shot process before starting new binaries.
3. Readiness must include DB connectivity, worker/outbox lag, publication policy epoch, source liveness and WS capacity; `/healthz` process liveness alone is insufficient to declare staging ready.

#### Agent procedure in order
- **Step 1.** Select staging target, ports/network/TLS/domains and secret manager. Document environment variables, permissions and ingress boundaries; prohibit unauthorized public decoded messages.
- **Step 2.** Build reproducible image/artifacts from exact tested SHA with pinned dependencies, immutable tags and SBOM if supported. No credentials baked into image.
- **Step 3.** Implement deployment order: schema compatibility check → migrations → API/workers/frontend → health → canary. Keep rollback path to previous binary with compatible DB schema.
- **Step 4.** Test source shutdown/disable feature flags, partial worker crash, migration failure, token rotation and explicit rollback without losing outbox/inbox history.
- **Step 5.** Create staging runbook and automated smoke against synthetic/restricted test data; record owner, URLs, PR, evidence and remaining public launch blockers.

#### Required demonstrable tests
- Deploy from cold start using staging config; restart all processes and verify durable messages/grants and WS resumption.
- Rollback latest app version to prior binary, schema safe, no corruption or exposed source token.
- Confirm only approved public data exposed through network firewall/TLS/route; runtime migrator credentials not available to API.
- Health alarms fire when consumer queue stalls even though `/healthz` returns 200.

#### Safety and task boundary
Staging readiness is not production release; #51 validates actual capacity and failure recovery.

#### Acceptance evidence that must be written into THIS issue
- Check original and new acceptance boxes only after real verification; link specific PR, merge SHA, runbook, operator approval, actual test/CI outputs and rollback plan.
- Mark BLOCKED if external rights/Actions/admin permission cannot be verified; never record a pass without evidence or skip required predecessor.
- On DONE close issue, check it in EPIC #4 and update progress; keep all authored issue, code, docs and release text English.


---

## 47. [#51] Execute representative load, soak and failure-injection qualification

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/51  
**Phase:** Release readiness (deferred)  
**Snapshot status:** BACKLOG · **Dependency:** Issue #50 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** DEFER until final production wave. Preserve full specification below.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Parent epic:** #4 · **Execution order:** 47 · **Phase:** Production readiness · **Status:** BACKLOG
> **Depends on:** #50 DONE (merged and verified); no overlapping active tasks.

### Objective / one-task deliverable
Capacity and reliability targets are demonstrated with measured conditions rather than assumptions.

### Implementation and operating procedure
1. Define measurable SLO/SLI for ingest-to-read latency, map p95, WebSocket reconnect/gap rate, queue age and error budget.
2. Run reproducible scenarios at documented aircraft, positions/sec, messages/sec, connected clients and viewport sizes; avoid real/private content in fixtures.
3. Inject provider 429/disconnect, PostgreSQL restart, delayed consumer ACK, long-running migration, stale subscription, receiver loss and permission revocation.
4. Record CPU/memory/DB locks, tail latency, retry/quarantine and projection convergence; identify the first bottleneck.
5. Fix critical reliability regressions in scope or open explicitly blocked follow-up issues and keep release blocked.

### Expected files / ownership
`tests/performance/`, `docs/PERFORMANCE.md`, alert/runbook updates.

### Verification plan
- Repeatable load and long-running soak with threshold checks; real post-restart data/inbox consistency.
- Evidence includes environment/hardware assumptions, distributions and failure results.

### Acceptance criteria
- Capacity envelope and failure recovery are measured with declared targets.
- No data/privacy loss or unrecoverable queue gap in the tested scenarios.
- Unmet release SLO remains a documented blocker.
- Evidence, merged PR/decision, test commands, actual CI status, risk/rollback and limitations recorded; parent #4 updated.

### Explicit boundaries
Does not infer global production performance from a small local benchmark.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Existing code to inspect

Stage6 #44 metrics, Stage5 #31 WS backpressure, staging #50 and docs/PERFORMANCE.md.

#### Owned new modules and configuration

tests/performance/{load,soak,fault}; docs/QUALIFICATION.md.

#### Exact deliverable, algorithm and failure tests

Define explicit p95 latency, queue lag, RPO/RTO recovery and concurrency targets on identified hardware. Run repeatable messages/sec, positions/sec, aircraft/viewport and connected clients load and soak; inject provider 429, DB restart, worker lost ACK and mid-stream revocation. Report measured results with logs, replay correctness and limits; unmet threshold BLOCKS release.

#### Agent execution handoff

Confirm predecessor DONE and merged. Before code, edit same issue status to IN PROGRESS with owner, UTC timestamp, branch, files and missing permissions. Implement smallest complete deliverable, add reproducible negative tests and record real commands/env/results. Never assume real CI is green. Update IN REVIEW with focused PR and checklist, then DONE only after merged SHA, evidence and rollback notes; update EPIC #4 checkbox/count and activate next issue. Permission, rights or unmet SLO means BLOCKED with clear unblock action.

### Agent implementation blueprint (2026-11-19)

> **Run this only after #50 is DONE and EPIC #4 makes this issue READY.** Stage2 base `main@373a2755` is historical; all intervening merged changes must be inspected. Every file path below is a proposed artifact, not proof of completed implementation.

#### Read existing and predecessor evidence
- `Stage6 #44 metric definitions, baseline workload and scaling ADR`
- `Stage5 WebSocket and scoped publication E2E`
- `Stage6 receiver/source integrations and retry/lease code`
- `Stage50 staging deployment and recovery runbook`

#### File-level execution artifacts
- `tests/performance/{workload-profile.json,run-load.mjs,chaos-scenarios.mjs}`
- `docs/PERFORMANCE_ACCEPTANCE.md`
- `docs/OPERATIONS_ALERTS.md update`
- `scripts/load/collect-results.mjs`

#### Concrete gates / operational contracts
1. Define a **proposed, adjustable and reviewable** initial workload profile, e.g. 500 aircraft in viewport, 10 position observations/sec, 1 message/sec, 50 concurrently subscribed clients, 30-minute soak plus faults. This is a test input, NOT a production capacity claim.
2. Require explicit targets to be approved in issue before running: sample p95 map snapshot <500 ms, message accepted→authorized visible p95 <5 s, WS reconnect/resync convergence <10 s for test profile; revise based on measured needs and document actual environment.
3. Metrics include p50/p95/p99 HTTP/WS latency, queue oldest age, retries/quarantine, PostgreSQL connection/lock waits, CPU/RAM, permission revocation lag and data-consistency checks.

#### Agent procedure in order
- **Step 1.** Select deterministic synthetic replay dataset, profile sizes, hardware/DB settings, test duration and approved numerical SLO. Keep all licensed source data out of load fixtures.
- **Step 2.** Run baseline with increasing client and observation load, record p95/p99 and capacity failures before changing implementation.
- **Step 3.** Inject source 429/timeout, PostgreSQL restart, worker kill between effect commit and ACK, slowed WS client, expired cursor, grant revoke during snapshot and clock skew.
- **Step 4.** Validate no lost message/position facts, duplicate public effects, post-revocation leakage or unbounded queues; repair critical regressions in explicitly scoped PR or create follow-up issue and keep release blocked.
- **Step 5.** Publish reproducible commands, raw aggregated (not sensitive) metrics, failure timeline, exact commit/env and recommendations. Rerun after any critical fix.

#### Required demonstrable tests
- Representative smoke and 30-minute soak with actual recorded outcomes; no skipped chaos scenario without documented blocker.
- Permission revocation across WS while under load completes within approved bound; otherwise fail.
- Recovery of persisted queue and consistent map snapshots after crash, no unauthorized data exposures.
- Ensure metrics do not include user/aircraft/message IDs as high-cardinality labels.

#### Safety and task boundary
A green average latency is not enough: tail performance, scope correctness and crash recovery must pass. #52 owns final production go/no-go.

#### Acceptance evidence that must be written into THIS issue
- Check original and new acceptance boxes only after real verification; link specific PR, merge SHA, runbook, operator approval, actual test/CI outputs and rollback plan.
- Mark BLOCKED if external rights/Actions/admin permission cannot be verified; never record a pass without evidence or skip required predecessor.
- On DONE close issue, check it in EPIC #4 and update progress; keep all authored issue, code, docs and release text English.


---

## 48. [#52] Run final production go/no-go review and controlled launch

**GitHub issue:** https://github.com/ppotepa/terminal-velocity/issues/52  
**Phase:** Release readiness (deferred)  
**Snapshot status:** BACKLOG · **Dependency:** Issue #51 (technical predecessor, or recorded code-first external exception)  
**Execution policy:** DEFER until final production wave. Preserve full specification below.

> **Instruction:** the following technical requirements are consolidated from the live GitHub issue. Dated architecture or path suggestions may predate later commits. Always inspect the current tree and use the newer confirmed contract when it has the same semantics. Checklist marks here are normalized to plain bullets; completion status lives on GitHub.

> **Parent epic:** #4 · **Execution order:** 48 · **Phase:** Production readiness · **Status:** BACKLOG
> **Depends on:** #51 DONE (merged and verified); no overlapping active tasks.

### Objective / one-task deliverable
The project is released publicly only after every preceding functional, rights, safety, CI, recovery and capacity gate has passed.

### Implementation and operating procedure
1. Verify all #4 child issues are DONE and linked to merged PRs with actual verification evidence; no unapproved skips.
2. Confirm real sources' redistribution rights, publication/redaction policy, station privacy, security review and expiry/revocation workflow.
3. Confirm green remote CI, tested backup restore, staging rollback, bounded load/soak targets and on-call operational runbooks.
4. Record version/commit, changelog, migration plan, deployment health acceptance and monitored canary period.
5. Perform controlled launch or explicitly document NO-GO with blockers and no public traffic; monitor canary and rollback if thresholds fail.

### Expected files / ownership
`docs/RELEASE_CHECKLIST.md`, signed release evidence, deployment notes.

### Verification plan
- Run full smoke/E2E in release environment; verify error/latency/unauthorized access and recovery drills.
- Attach sign-off evidence, release link, incident escalation and rollback results.

### Acceptance criteria
- All mandatory gates have explicit evidence and owner approval.
- Public data exposes only authorized content and indicators.
- Release is traceable and rollback-ready, or remains blocked with a precise reason.
- Evidence, merged PR/decision, test commands, actual CI status, risk/rollback and limitations recorded; parent #4 updated.

### Explicit boundaries
A checklist alone is not proof of launch; do not call this DONE without actual release evidence.

### Agent-ready technical execution plan (v2 — 2026-11-19)

#### Existing code to inspect

EPIC #4 complete checklist, merged #5–#51 PRs, rights #46, security #45, backups #48, CI #49, staging #50, load #51.

#### Owned new modules and configuration

docs/RELEASE_CHECKLIST.md, release manifest and deployed version evidence.

#### Exact deliverable, algorithm and failure tests

Go/no-go checklist must cite real source redistribution permissions, no unauthorized status/count/payload leaks, actual green remote CI, tested backups/rollback, measured traffic and operator owner. Pin release SHA/tag, deploy small canary and monitor error budget, roll back on threshold violation. If any mandatory gate lacks evidence publish NO-GO and leave issue open/BLOCKED; never mark shipped based solely on planned tasks.

#### Agent execution handoff

Confirm predecessor DONE and merged. Before code, edit same issue status to IN PROGRESS with owner, UTC timestamp, branch, files and missing permissions. Implement smallest complete deliverable, add reproducible negative tests and record real commands/env/results. Never assume real CI is green. Update IN REVIEW with focused PR and checklist, then DONE only after merged SHA, evidence and rollback notes; update EPIC #4 checkbox/count and activate next issue. Permission, rights or unmet SLO means BLOCKED with clear unblock action.

### Agent implementation blueprint (2026-11-19)

> **Run this only after #51 is DONE and EPIC #4 makes this issue READY.** Stage2 base `main@373a2755` is historical; all intervening merged changes must be inspected. Every file path below is a proposed artifact, not proof of completed implementation.

#### Read existing and predecessor evidence
- `EPIC #4 checklist #5–#52 and all issue status logs`
- `docs/ROADMAP.md and docs/IMPLEMENTATION_STATUS.md`
- `Stage45 threat model, Stage46 rights register, Stage48 restore evidence`
- `Stage49 remote CI checks, Stage50 staging deployment and Stage51 load qualification`

#### File-level execution artifacts
- `docs/RELEASE_CHECKLIST.md`
- `docs/releases/<version>-go-no-go.md`
- `deploy/scripts/release-smoke.sh (reusing Stage50 smoke)`
- `docs/OPERATIONS_ONCALL.md final links`

#### Concrete gates / operational contracts
1. Release gate matrix must identify each predecessor issue, merged PR+SHA, actual tests, signed source entitlements, migration schema, restore drill, approved SLO, staging canary and owner. Missing or blocked evidence means `NO_GO`.
2. Required release record: version/tag, commit SHA, migrations and rollback, exact public allowed data classes, monitored first-time window, alert threshold owner and current GitHub Actions run URL.
3. Only a successfully deployed, monitored public release with approved data rights can be marked `DONE`; a launch-plan document alone is NOT completion.

#### Agent procedure in order
- **Step 1.** Audit EPIC #4: every child before #52 closed `DONE` with checked acceptance and merged PR. Reconcile discrepancies before writing release candidate.
- **Step 2.** Conduct documented review of source/mapping licenses, public message + derived metadata rights, station-location privacy and emergency takedown.
- **Step 3.** Confirm remote CI passes on final SHA, backups and disaster restore were drilled, branch release rules are enforced, staging rollback succeeded, load qualification met targets.
- **Step 4.** Prepare exact release version, migrations, canary percentage/step plan, health probes, rollback triggers and on-call rotation; verify secrets/retention and support paths.
- **Step 5.** Perform controlled canary deployment with synthetic/approved data, observe metrics for specified review period, record outcomes; go to general availability only on green gates, otherwise rollback and file a NO_GO with blockers.

#### Required demonstrable tests
- End-to-end browser map, source message display, public/private isolation, WebSocket reconnect and grant revocation on release SHA.
- Production ingress checks for missing auth, limits, sensitive source data, station precision and correct map attribution.
- Post-release status, backlog queue, error rates, p95 latency, canary rollback drill evidence; links and timestamps recorded.
- No gate waived silently; if unavailable, mark issue BLOCKED with responsible owner.

#### Safety and task boundary
Final issue is the only one that closes EPIC #4. Do not mark project launched while real data rights, green remote CI, recovery or privacy gates are unverified.

#### Acceptance evidence that must be written into THIS issue
- Check original and new acceptance boxes only after real verification; link specific PR, merge SHA, runbook, operator approval, actual test/CI outputs and rollback plan.
- Mark BLOCKED if external rights/Actions/admin permission cannot be verified; never record a pass without evidence or skip required predecessor.
- On DONE close issue, check it in EPIC #4 and update progress; keep all authored issue, code, docs and release text English.

---

## I. Final-phase queue and explicit closure conditions

**Before #49:** demonstrate that the local synthetic prototype satisfies G1–G6; do not add GitHub Actions workflows or production infrastructure just to mark the prototype functional.

**At #45–#46:** audit threat model and data licenses. High-severity local vulnerabilities should be fixed before unrestricted connections; real rights/governance approvals are still external and cannot be automated away.

**At #47–#48:** implement bounded retention and test a genuine PostgreSQL restore locally. Keep immutable evidence and tombstones long enough for replay correctness.

**At #49–#52 only after owner accepts the prototype:** configure remote CI/CD, staging, formal scale tests and final production launch. These issues retain full detailed instructions above, but are not a reason to block the initial map and communication functionality.

### Unblock checklist for real messages and positions

- [ ] Explicit selected provider/account/endpoint or controlled receiver, actual current terms and review date.
- [ ] Legal/contractual right to read and **store** provider observations in the intended private database.
- [ ] Separate right to redistribute raw/decoded content and derivative indicators publicly, or recorded prohibition.
- [ ] Allowed anonymized sample or test feed with real field meanings, timing precision, source coverage and stable/unstable ID semantics.
- [ ] No fabricated reception, RF frame, sampling completeness, satellite content, position-history ID, station identity or flight-session match.
- [ ] Source-specific retention, backfill and rate limits documented. Secrets handled outside Git.
- [ ] Actual private integration smoke with provenance, restart, duplicate rejection and negative cases, recorded without confidential data.

## J. Copy/paste prompt for an implementation agent

```text
You are the implementation agent for ppotepa/terminal-velocity.

Primary objective: finish a working private aviation tracker, one GitHub issue at
a time, using the concrete work packages and global invariants in
docs/MASTER_IMPLEMENTATION_PLAN.md. Do not invest in hosted CI/CD, staging,
public deployment or GitHub Actions now; those are postponed to #49–#52.
Local type checks, domain tests, actual PostgreSQL integration for durable
changes, and browser/API smoke for user-visible behavior ARE required.

Before doing anything: read AGENTS.md, docs/ISSUE_WORKFLOW.md, this master plan,
EPIC #4, the active issue and its predecessor; query live main and open PRs
via GitHub. Never assume a planned path is already implemented. Check for
in-progress branches or external blockers and avoid duplicating work.

The current software gate starts with issue #17 / draft PR #66, then #18
through #44 in order, unless GitHub shows additional work merged. Issues
#6, #9, #10, #11, #13 and #15 have external acceptance gaps; do not falsely
close them. Independently runnable local code may proceed under the explicit
code-first EPIC exception. Do not use unapproved real feeds or publish data.

Execute one issue end to end: validated contract, pure domain rules, narrow
ports, application use case, SQL/provider/API/UI adapter and composition,
tests including failure/idempotency/races, docs, focused code review, PR,
merge, actual evidence in the issue body, close only on full acceptance,
and update the EPIC checklist and next status.

Follow strict SRP, English-only repository text, immutable source/identity/
position facts, observation-time semantics, transactionally atomic outbox
and inbox, privacy of derived map/count/status/cursors, and bounded replay.
Never invent successful test results, permissions, RF frames or live data.
Document the exact remaining blocker if work cannot finish.

At the end report: issue/PR URLs, merge SHA, files and behavior delivered,
local commands actually run and their results, unresolved external gates,
EPIC Done count, and the next issue.
```

## K. Project links and documentation hierarchy

- [EPIC #4 — canonical live issue checklist](https://github.com/ppotepa/terminal-velocity/issues/4)
- [Roadmap](https://github.com/ppotepa/terminal-velocity/blob/main/docs/ROADMAP.md)
- [Implementation status](https://github.com/ppotepa/terminal-velocity/blob/main/docs/IMPLEMENTATION_STATUS.md)
- [Engineering rules](https://github.com/ppotepa/terminal-velocity/blob/main/AGENTS.md)
- [Issue lifecycle](https://github.com/ppotepa/terminal-velocity/blob/main/docs/ISSUE_WORKFLOW.md)
- [PostgreSQL runbook](https://github.com/ppotepa/terminal-velocity/blob/main/docs/POSTGRES.md)
- [Provider pipeline](https://github.com/ppotepa/terminal-velocity/blob/main/docs/PROVIDER_PIPELINE.md)
- [Source acceptance limits](https://github.com/ppotepa/terminal-velocity/blob/main/docs/SOURCE_INTEGRATION_RUNBOOK.md)
- [HTTP API](https://github.com/ppotepa/terminal-velocity/blob/main/docs/API.md)
- [Architecture v2](https://github.com/ppotepa/terminal-velocity/blob/main/docs/architecture/ARCHITECTURE_V2.md)

**Document status:** code-first implementation handbook. Review the live issues before each execution session and revise this document when the roadmap's actual architecture or user priorities materially change. It intentionally does not instruct agents to make GitHub Actions green during current implementation.
