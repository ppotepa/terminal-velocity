# Private source replay operations — issue #12

The replay runner is an administrative, bounded historical recovery facility.
It is separate from `npm run messages -- crawl ICAO24`, which still reads the
actual rendered Airframes view on demand and returns observations in memory/stdout.
The provider API remains inactive. No replay CLI connects to Airframes, retains
real content, or grants collection, retention, or publication rights.

## Entry points and limits

`replaySourceRange` is exported by the source-connectors public boundary. Supply a
configured reader, current collection authorization, durable receipt adapter,
source coverage, clock and PostgreSQL replay store. The supplied
`createObservationReplayDelivery` composition uses the existing atomic metadata
acceptance/outbox transaction. It excludes decoded text and RF content from SQL.
The CLI configures only the explicit synthetic fixture reader. A future approved
provider reader must enforce byte/record limits while reading, honor AbortSignal,
and implement the provider's actual cursor contract. This is not an implemented
Airframes historical pagination API.

Each invocation performs at most one page fetch, sequential receipts and one
cursor advancement after all receipts succeed. Requests require exact
source/provider/account/epoch, a named checkpoint, `[from,to)` in epoch
milliseconds, a completed historical range and a delivery limit (1–500).
Default limits are 24 hours, 20 requests, 100 records/page, 256 KiB/page,
10-second fetch timeout, 1-second minimum interval, 5 failed attempts and
60-second maximum retry delay. Provider configuration can tighten these limits;
validated hard caps prevent unbounded runs. Large records are checked independently
of the reader's reported byte count. The adapter must bound allocation during
fetch; the orchestration layer cannot undo an adapter's earlier allocation.

The source scope has one PostgreSQL session advisory lock and one durable current
checkpoint. Concurrent attempts fail immediately. Allocate at least two pool
connections: one for the source lock and one for receipt transactions. A reserved
attempt, request budget and cooldown commit before fetch. Every save is an atomic
SQL statement on the lock connection; receipts commit in their existing separate
transaction. Process/connection loss releases the lock. A failed checkpoint save
never advances a cursor; replay may repeat already committed receipts. Existing
source identity checks prevent duplicate effects. Counts describe acknowledged
receipts recorded in the checkpoint, not a unique-source completeness estimate;
a crash before saving an acknowledgment can later report that receipt as duplicate.

Retry-After is measured from response receipt, never request start. The scheduled
retry is no earlier than the durable reservation and provider delay. Backoff is
deterministic exponential; no jitter shortens that delay. A new completed-range
checkpoint preserves source cooldown and health. Incomplete/quarantined ranges
cannot be silently replaced. Epoch changes require an explicit operator decision;
they change identity and must not be used to evade budgets or permissions.

## Local commands

Apply migration 006 with the existing migration tool in an approved local
instance. The API never runs migrations. Provide a restricted runtime
`DATABASE_URL` by the existing private environment mechanism. Do not paste it
into logs or issue evidence. CLI URLs must use explicit `127.0.0.1` or `[::1]`
and cannot contain query parameters or fragments. No remote target, cleanup,
module loading, file import, or unscoped listing option is supported.

```sh
npm run source:replay -- --fixture --source src_synthetic --provider synthetic \
  --account private-fixture --epoch fixture-1 --checkpoint window-1 \
  --from 1000 --to 2000 --limit 10
npm run source:inspect -- --source src_synthetic --provider synthetic \
  --account private-fixture --epoch fixture-1
```

Run the same replay command after `nextAttemptAt` to resume its overlapping second
fixture page. This produces one metadata delivery, one source event and a duplicate
receipt. Repeating a COMPLETE checkpoint does no work. A different named range is
accepted only after completion of the previous range.

Inspection returns digested source/checkpoint IDs, bounded range, mode, counters,
state, safe error code, cooldown, review count and health. It never returns opaque
cursor contents, original identifiers, raw errors, credentials or message text.
Only the current checkpoint is stored per scope; this is not an immutable audit
archive. Quarantine retains redacted state and a resumable cursor, not poison
payloads. Recover by refetching corrected source data within the same bounded range.

## Failure recovery

- Partial outage/disconnect/allowed 5xx: inspect `TRANSIENT_FAILURE`; wait for
  `nextAttemptAt`, then invoke the exact request again. 429 `RETRY_AFTER` respects
  the provider delay. Excessive Retry-After, attempt/request/delivery budget
  exhaustion or `QUOTA_EXHAUSTED` stops in durable quarantine. Investigate and
  explicitly review; restarting the process cannot reset the budget.
- Malformed layout, poison payload, missing actual observation time or clock skew:
  fetch and parse outcomes remain separate. Fix the parser or source time evidence
  using synthetic/redacted permitted fixtures. Do not substitute ingestion time,
  drop poison records or claim that a parse failure was an empty healthy sample.
- Expired cursor: inspect `CURSOR_EXPIRED`, verify that the provider still exposes
  the whole original interval, then explicitly review with
  `RESTART_BOUNDED_RANGE`. The cursor resets and duplicate receipts are expected.
  If the interval is unavailable, leave quarantine unresolved and report the gap;
  never mark that interval complete or invent source coverage.
- Rights/terms changes or unauthorized access: `RIGHTS_REVOKED` / `UNAUTHORIZED`
  disables ingestion. Stop any scheduled invocation, review the source decision
  and obtain current scope-specific permission. Review independently rechecks
  authorization and never enables a live adapter. No automatic retry is made.
- Lost acknowledgment/crash: keep the same epoch and range. The reserved budget
  survives, while any durable receipt is deduplicated on recovery. Partial pages
  can consume the remaining delivery budget through repeated receipts and therefore
  require review rather than skipping records.

After resolving the cause, use the original complete replay arguments plus
`--resolve RETRY_SAME_PAGE`, or `--resolve RESTART_BOUNDED_RANGE` for cursor expiry.
Review only changes quarantine to READY; invoke replay separately after cooldown.
It preserves cumulative outcome counters and last error as evidence, increments
reviews, and grants a fresh bounded request/delivery budget. This is an operator
attestation, not permission evidence. The configured CLI permits synthetic review
only; actual provider recovery needs an approved composition and policy.

## Health and the #13 handoff

`connectionState`, `fetchOutcome`, `parseOutcome`, `receiptOutcome`, `lastConnectionAt`,
`lastProviderEventAt`, `ingestLag`, `coverageKind` and `asOf` are independent of
message publication and aircraft freshness. Receipt failures preserve the successful
parse result instead of blaming the parser. An empty valid SAMPLED page can be
HEALTHY; it advances neither provider event time nor coverage to a complete feed.
Inspection recalculates lag from the last valid observed timestamp. A successful
parse records that timestamp even if later durable acceptance fails. Health is
the last attempt's result, not a continuous liveness guarantee or RF completeness
percentage. Backfill preserves observation time and never creates a fresh status
merely through a newer ingestion timestamp.

For #13, the owner must first supply approved collection/retention terms and a
private provider smoke scope, an actual bounded cursor contract and permitted
redacted fixtures. Then verify the real adapter's timeout/size enforcement,
partial outage, drift and cursor recovery in that scope; record sanitized counters
and separate fetch/parse results, never payloads. The synthetic suite proves
engineering behavior only. No live smoke, deployment, external acceptance or
provider rights are claimed here.

Migration 006 adds only a private metadata checkpoint table. Roll back application
use by stopping replay commands and retaining the table and migration history;
do not delete checkpoints to clear quarantine or edit an applied migration.
Existing on-demand lookup, API and event delivery worker operate independently.
