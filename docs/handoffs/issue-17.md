# Issue #17 engineering handoff

## Scope and state

The `feature/epic4-issue-17` checkout contains the temporal fleet identity implementation on top of merged predecessor #16. The coordinator owns commits, GitHub issue and PR updates, merge, and the next issue. This handoff does not mark #17 accepted or merged.

The registry stores stable internal aircraft IDs and append-only ICAO24 and registration assertions with source, issuer, validity interval, recorded time, and revision. Resolution uses the observation time and reports matched, ambiguous, conflicted, unmatched, or incomplete results. Position link revisions are separate from immutable position facts. Alias changes enqueue bounded position and message re-evaluation; message replay appends correlation decisions and outbox events without replacing source revisions. The public candidate directory preserves complete and partial snapshots. The rendered Airframes on-demand command remains separate and retains no real message content.

## Migration and replay

Migrations 008 and 009 add the registry, assertion and link history, replay requests with durable cursors, and lookup indexes. The runtime role has narrow table and cursor grants; the owner role has `NOLOGIN`. Corrections append assertions and request ranges. A failed replay page keeps its cursor, and repeated position work is idempotent. Rollback of application code leaves these additive tables and their history in place. Reversal of schema requires a new history-preserving migration.

## Verification evidence

The coordinator's isolated CI at `5bb60684d2d46022eaf4afa51dde0cb0f16f3dc5` used Node 24.22.3 and PostgreSQL 17.12. `npm ci`, `npm run check`, `npm run test:postgres:local`, `npm run demo`, `npm run smoke`, and `npm run test:messages` passed. `npm run test:browser` passed 25 of 26 tests. Its one failure was `reordered displayed duplicates across samples reject changed facts`.

The subsequent browser fixture correction keeps the assertions unchanged and changes synthetic DOM only after the first synchronous card sample. It is uncommitted in this checkout and requires an exact-SHA browser rerun by the coordinator. In the authoring shell, Node 24 type checking and architecture boundaries passed; the backend unit suite passed 19 test files; `npm run test:messages` passed 3 test files; syntax and `git diff --check` passed. `npm run check` could not finish here because the private-preview fixture cannot bind loopback in this root sandbox. Direct browser launch also failed in this sandbox, so no local browser pass is claimed for the correction.

## External gates

All implementation evidence uses synthetic data. Provider rights, real-source retention, publication policy, deployment, and owner acceptance remain external decisions. This change adds no public map or flight-session recognition. The coordinator should run exact-SHA CI, review the migration and correction, then update #17 and epic #4 according to the issue workflow. Only after merge and verification can #17 be marked `DONE` and the next issue activated.
