# Issue #17 engineering handoff

## Scope and state

The `feature/epic4-issue-17` checkout contains the temporal fleet identity implementation on top of merged predecessor #16. The coordinator owns commits, GitHub issue and PR updates, merge, and the next issue. This handoff does not mark #17 accepted or merged.

The registry stores stable internal aircraft IDs and append-only ICAO24 and registration assertions with source, issuer, validity interval, recorded time, and revision. Resolution uses the observation time and reports matched, ambiguous, conflicted, unmatched, or incomplete results. Position link revisions are separate from immutable position facts. Alias changes enqueue bounded position and message re-evaluation; message replay appends correlation decisions and outbox events without replacing source revisions. The public candidate directory preserves complete and partial snapshots. The rendered Airframes on-demand command remains separate and retains no real message content.

## Migration and replay

Migrations 008–010 add the registry, assertion and link history, replay requests with durable cursors, lookup indexes, and a position-link job queue. Migration 011 enforces same-source and same-issuer correction authority for every SQL writer and rejects an upgrade if existing history violates that rule. A database trigger queues a job in the same transaction as each new position fact. The worker handles new-position jobs and correction pages with one checked-out connection per transaction. A durable alternating turn gives both work classes progress under a continuous feed. A changed assertion queues its own alias and overlapping current aliases of both affected aircraft, because their decisions may change even when observations do not contain the changed alias. Each request runs in bounded pages; a failed page or job rolls back its cursor and turn, and repeated position work is idempotent. The runtime role has narrow grants; the owner role has `NOLOGIN`.

Migrations 008–011 are additive and have no destructive down migration. Rolling back application code must preserve assertion, position-link decision, replay-request, job, message-decision, and outbox history; an older worker may leave new jobs or requests pending. Correcting or retiring the schema requires a forward, history-preserving migration and replay plan. No schema rollback or deployment has been performed.

## Verification evidence

The coordinator's supplied exact-SHA isolated CI for `c468592623c34eacfc1732237a67880656805d8e` passed offline `npm ci`, `npm run check` (189 backend and 30 API tests), `npm run test:postgres:local` (105 tests), `npm run demo`, `npm run smoke`, `npm run test:messages` (41 tests), and `npm run test:browser` (26 tests). This is trusted local CI evidence for that commit, not hosted CI. Review then found that reader failure escaped the public resolution contract and sustained position jobs could starve correction replay. The correction returns `INCOMPLETE/LOOKUP_FAILED` with revision zero when no registry revision is trustworthy and stores a fair work-class turn in migration 010. Current exact-SHA and merged-SHA verification evidence is maintained in issue #17 and the reviewed PR.

The supplied isolated CI for `26fff83d194f04d132e81f208dfe130f22fb4510` passed `npm run check` (32 script, 191 backend, 30 API tests) but failed two PostgreSQL upgrade tests: their expected migration lists ended at 010 after migration 011 was added. This checkout updates those lists to include 011. A new exact-SHA PostgreSQL run is required to verify the correction. In this authoring sandbox, Node 24 type checking and the architecture gate pass; the test runner cannot bind loopback sockets (`EPERM`), so a local full check or database suite is not claimed.

## External gates

All implementation evidence uses synthetic data. Provider rights, real-source retention, publication policy, deployment, and owner acceptance remain external decisions. This change adds no public map or flight-session recognition. The coordinator should run exact-SHA CI, review the migration and correction, then update #17 and epic #4 according to the issue workflow. Only after merge and verification can #17 be marked `DONE` and the next issue activated.
