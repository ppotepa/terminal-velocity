# Issue #17 engineering handoff

## Scope and state

The `feature/epic4-issue-17` checkout contains the temporal fleet identity implementation on top of merged predecessor #16. The coordinator owns commits, GitHub issue and PR updates, merge, and the next issue. This handoff does not mark #17 accepted or merged.

The registry stores stable internal aircraft IDs and append-only ICAO24 and registration assertions with source, issuer, validity interval, recorded time, and revision. Resolution uses the observation time and reports matched, ambiguous, conflicted, unmatched, or incomplete results. Position link revisions are separate from immutable position facts. Alias changes enqueue bounded position and message re-evaluation; message replay appends correlation decisions and outbox events without replacing source revisions. The public candidate directory preserves complete and partial snapshots. The rendered Airframes on-demand command remains separate and retains no real message content.

## Migration and replay

Migrations 008–010 add the registry, assertion and link history, replay requests with durable cursors, lookup indexes, and a position-link job queue. A database trigger queues a job in the same transaction as each new position fact. The worker handles new-position jobs and correction pages with one checked-out connection per transaction. A changed assertion queues its own alias and overlapping current aliases of both affected aircraft, because their decisions may change even when observations do not contain the changed alias. Each request runs in bounded pages; a failed page or job rolls back its progress, and repeated position work is idempotent. The runtime role has narrow grants; the owner role has `NOLOGIN`.

Migrations 008–010 are additive and have no destructive down migration. Rolling back application code must preserve assertion, position-link decision, replay-request, job, message-decision, and outbox history; an older worker may leave new jobs or requests pending. Correcting or retiring the schema requires a forward, history-preserving migration and replay plan. No schema rollback or deployment has been performed.

## Verification evidence

The coordinator's supplied exact-SHA isolated CI for `2a6b7a2` passed offline `npm ci`, `npm run check`, `npm run test:postgres:local`, `npm run demo`, `npm run smoke`, `npm run test:messages`, and `npm run test:browser`. This is trusted local CI evidence for that commit, not hosted CI. Review then identified two behavior gaps: adding a second overlapping ICAO24 could leave a message using the first ICAO24 confirmed, and position resolution did not veto that same active-alias conflict. The fixes and new PostgreSQL regression in this checkout postdate `2a6b7a2` and require a new exact-SHA isolated CI run.

The coordinator's exact-SHA isolated CI at `732155217ef20248c74d20a68f772c75770a3b5d` passed installation and `npm run check` but failed PostgreSQL integration: two upgrade tests expected the migration list to end at 009. Both assertions now include migration 010. The provided CI summary names only those two failing tests; this patch still needs an exact-SHA PostgreSQL rerun to verify their full behavior.

For this correction, Node 24.22.3 offline `npm ci`, type checking, architecture boundaries, the fleet-identity unit file, and `git diff --check` passed in the authoring checkout. `npm run check` passed type checking and architecture checks, then stopped at the existing private-preview test in this shell. `npm run test:postgres:local` stopped before tests because `initdb` refuses root; the new PostgreSQL regression is not claimed passing here. No browser behavior changed in this correction. The coordinator must run exact-SHA CI for these edits.

## External gates

All implementation evidence uses synthetic data. Provider rights, real-source retention, publication policy, deployment, and owner acceptance remain external decisions. This change adds no public map or flight-session recognition. The coordinator should run exact-SHA CI, review the migration and correction, then update #17 and epic #4 according to the issue workflow. Only after merge and verification can #17 be marked `DONE` and the next issue activated.
