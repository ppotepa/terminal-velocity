# Issue #17 engineering handoff

## Scope and state

The `feature/epic4-issue-17` checkout contains the temporal fleet identity implementation on top of merged predecessor #16. The coordinator owns commits, GitHub issue and PR updates, merge, and the next issue. This handoff does not mark #17 accepted or merged.

The registry stores stable internal aircraft IDs and append-only ICAO24 and registration assertions with source, issuer, validity interval, recorded time, and revision. Resolution uses the observation time and reports matched, ambiguous, conflicted, unmatched, or incomplete results. Position link revisions are separate from immutable position facts. Alias changes enqueue bounded position and message re-evaluation; message replay appends correlation decisions and outbox events without replacing source revisions. The public candidate directory preserves complete and partial snapshots. The rendered Airframes on-demand command remains separate and retains no real message content.

## Migration and replay

Migrations 008–010 add the registry, assertion and link history, replay requests with durable cursors, lookup indexes, and a position-link job queue. A database trigger queues a job in the same transaction as each new position fact. The worker handles new-position jobs and correction pages with one checked-out connection per transaction. A failed page or job rolls back its progress; repeated position work is idempotent. The runtime role has narrow grants; the owner role has `NOLOGIN`. Application rollback retains these additive tables and their history. Reversal of schema requires a new history-preserving migration.

## Verification evidence

The coordinator's isolated CI at `2a523d9` used Node 24 and PostgreSQL and passed `npm ci`, `npm run check`, `npm run test:postgres:local`, `npm run demo`, `npm run smoke`, `npm run test:messages`, and `npm run test:browser`. This is an isolated local pass, not hosted CI. Review then found that positions appended after a correction request completed lacked an automatic first decision and that replay pages could exhaust their own connection pool. Migration 010 and the same-connection worker change address those gaps. Their exact-SHA verification must be recorded separately by the coordinator after this patch is committed and tested.

The coordinator's exact-SHA isolated CI at `732155217ef20248c74d20a68f772c75770a3b5d` passed installation and `npm run check` but failed PostgreSQL integration: two upgrade tests expected the migration list to end at 009. Both assertions now include migration 010. The provided CI summary names only those two failing tests; this patch still needs an exact-SHA PostgreSQL rerun to verify their full behavior.

For the preceding follow-up in the authoring checkout, Node 24.22.3 ran offline `npm ci`, type checking, architecture checks, 19 backend unit test files, and `npm run test:messages` successfully. In the current shell, `npm run check` completed type checking and architecture checks but stopped in the private-preview test because the installed Node is v20.19.2 and cannot load the imported TypeScript file. The PostgreSQL integration runner refused root; an attempted ephemeral server command was rejected by automatic command review because it used `rm -rf` for cleanup. The migration upgrade tests require the coordinator's isolated CI. No browser behavior changed in this follow-up.

## External gates

All implementation evidence uses synthetic data. Provider rights, real-source retention, publication policy, deployment, and owner acceptance remain external decisions. This change adds no public map or flight-session recognition. The coordinator should run exact-SHA CI, review the migration and correction, then update #17 and epic #4 according to the issue workflow. Only after merge and verification can #17 be marked `DONE` and the next issue activated.
