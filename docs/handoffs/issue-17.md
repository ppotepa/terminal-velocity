# Issue #17 engineering handoff

## Scope and state

The `feature/epic4-issue-17` checkout contains the temporal fleet identity implementation on top of merged predecessor #16. The coordinator owns commits, GitHub issue and PR updates, merge, and the next issue. This handoff does not mark #17 accepted or merged.

The registry stores stable internal aircraft IDs and append-only ICAO24 and registration assertions with source, issuer, validity interval, recorded time, and revision. Resolution uses the observation time and reports matched, ambiguous, conflicted, unmatched, or incomplete results. Position link revisions are separate from immutable position facts. Alias changes enqueue bounded position and message re-evaluation; message replay appends correlation decisions and outbox events without replacing source revisions. The public candidate directory preserves complete and partial snapshots. The rendered Airframes on-demand command remains separate and retains no real message content.

## Migration and replay

Migrations 008–010 add the registry, assertion and link history, replay requests with durable cursors, lookup indexes, and a position-link job queue. Migration 011 enforces same-source and same-issuer correction authority for every SQL writer and rejects an upgrade if existing history violates that rule. Migration 012 adds bounded, durable alias-expansion tasks. A database trigger queues a job in the same transaction as each new position fact. The worker handles new-position jobs, alias expansions, and correction pages with one checked-out connection per transaction. Durable scheduling advances new positions and correction work under a continuous feed. A changed assertion queues its own alias and paginates overlapping current aliases of both affected aircraft, because their decisions may change even when observations do not contain the changed alias. Each request runs in bounded pages; a failed page or job rolls back its cursor and turn, and repeated position work is idempotent. The runtime role has narrow grants; the owner role has `NOLOGIN`.

Migrations 008–012 are additive and have no destructive down migration. Rolling back application code must preserve assertion, position-link decision, replay-request, job, message-decision, and outbox history; an older worker may leave new jobs or requests pending. Correcting or retiring the schema requires a forward, history-preserving migration and replay plan. No schema rollback or deployment has been performed.

## Verification evidence

The coordinator's isolated exact-SHA CI for `6faa59d12f86eb481c04067863a1c16eff6a1de7` passed offline `npm ci`, `npm run check` (33 script, 191 backend, 30 API tests), `npm run test:postgres:local` (111 tests), demo, smoke, message tests (41), and browser tests (26). This proves the tested commit in isolated local CI; it is not hosted CI or merged-SHA verification.

Independent review found that the registry reader's 1,001-row completeness limit included expired aliases, history returned an unlimited array, and the correction message query did not prove use of migration 009's fixed-path indexes. The follow-up filters candidates at observation time before the limit, pages assertion history with a 500-row maximum and assertion-ID cursor, and uses literal JSON alias paths. Synthetic PostgreSQL regressions cover more than 1,001 expired assertions and the actual replay query's plan on a populated retained-message table. The issue and reviewed PR hold the exact-SHA and merged-SHA results for this follow-up.

## External gates

All implementation evidence uses synthetic data. Provider rights, real-source retention, publication policy, deployment, and owner acceptance remain external decisions. This change adds no public map or flight-session recognition. The coordinator should run exact-SHA CI, review the migration and correction, then update #17 and epic #4 according to the issue workflow. Only after merge and verification can #17 be marked `DONE` and the next issue activated.
