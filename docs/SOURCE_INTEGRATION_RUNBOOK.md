# Stage 3 source validation — issue #13

## Current decision

**External acceptance is blocked.** No approved Airframes collection and retention
terms, authorized private sample, or owner-approved smoke scope were supplied for
this checkout. No actual provider observation was inspected, retained, or sent to
PostgreSQL for issue #13. The deferred provider API remains inactive. A synthetic
trace test exercises the durable path but cannot establish a licensed feed, source
lag, actual format, or end-to-end latency. Stage 3 remains in progress pending
external acceptance; Stage 4 cannot rely on a validated real feed yet.

`npm run messages -- crawl ICAO24` is the separate on-demand rendered-page lookup.
It reads the actual selected Airframes view when explicitly invoked and returns
records in memory/stdout. It does not retain them. The fixture tests inject a
synthetic reader; they are never evidence of actual Airframes data or permission.

## Prerequisites for an authorized private smoke

The owner must record the selected page URL and chosen aircraft, permitted crawl
window, account or access scope, current collection and retention terms, intended
private use, retention period, and a reference to the rights decision outside Git.
Confirm whether the source exposes decoded provider messages, actual RF frames, or
station receptions. Do not infer a station, frame, global coverage, or publication
right from decoded text. Arrange an isolated PostgreSQL database with the existing
runtime role and migrations; the API never runs migrations or uses owner credentials.
The operator must supply an approved rendered-page reader and the scoped
`RetentionPermission` from trusted configuration. A preview grant alone is not a
retention grant. Keep all resulting access and reads private; there is no
authenticated source-derived HTTP endpoint at this stage.

## Evidence procedure

1. Record the UTC retrieval start and end, page URL, source kind, provider and
   data level. Use the approved one-shot crawl within its documented limits.
   Confirm the inspected record is legally retainable before passing it to
   `createPermittedProviderPipeline.acceptRendered`. Never save raw HTML,
   screenshots, secret headers, private text, or exact payloads in Git or CI logs.
2. Record the acceptance receipt and durable source delivery ID as redacted
   references. Confirm its provider observation ID, scope, immutable retained
   input, source observation time and ingestion time in the isolated database.
   Compare observation time with retrieval time; neither ingestion nor replay
   time may substitute for a missing observation timestamp.
3. Stop and restart the worker composition before draining the source import and
   private projection. Inspect the linked logical message revision, decision
   revision and private contribution revision. Record `MATCHED` or `UNMATCHED`
   explicitly. For a match, inspect `readPrivateStatus` for the same source
   delivery and observed time. For an unmatched message, inspect the decision
   and confirm no aircraft has a new private contribution.
4. Replay the same source delivery and verify a duplicate receipt without a
   second fact, decision or contribution. Exercise a malformed record, missing
   or uncertain time, unknown aircraft, and a disconnected source. Record the
   error or quarantine reason; verify none creates a false fresh status.
5. Separately record connector health and private availability. A healthy fetch
   does not prove aircraft freshness or complete coverage. Check the demo HTTP
   reads remain synthetic, with no source-derived message, count or status.
6. Calculate observed retrieval-to-receipt and retrieval-to-private-read
   intervals from the captured UTC times. Report the actual tested sample and
   environment only; a single observation is no capacity or coverage estimate.

Use `npm run check` and `npm run test:postgres:local` in the coordinator's
isolated, unprivileged environment. The `source-validation.test.mjs` PostgreSQL
test is discovered by the existing integration runner. Run the browser and
messages suites as well. Do not equate a local result with hosted CI.

## Redacted evidence record

Fill this only from an authorized run. Leave fields unknown until observed.

| Field | Observed value |
|---|---|
| Source page, kind, UTC window | Pending authorized run |
| Rights decision reference and private retention scope | Pending owner decision |
| Data level and actual source capability | Unverified |
| Redacted source delivery and provider observation IDs | Pending authorized run |
| Logical message and decision revisions | Pending authorized run |
| Correlation result and private contribution revision | Pending authorized run |
| Observed, retrieved and ingested UTC times | Pending authorized run |
| Private read result, source health, replay result | Pending authorized run |
| Source lag and end-to-end measured intervals | Unmeasured |
| PostgreSQL, browser, messages and CI command results | Pending final revision |

The source-derived private projection is an internal read port. There is no
authorized source-derived HTTP read API, so HTTP acceptance remains blocked until
an authenticated, private surface and its access policy are approved. Do not
route private source tables through the anonymous synthetic demo API. Publication
eligibility is a separate later decision.

## Failure and rollback

Reject a record whose decoded layout, source identity or time cannot be verified.
Retain an explicit quarantine outcome rather than converting a failed decode to
an empty healthy page. A disconnected reader reports source health independently;
it does not refresh any aircraft. Retry within the bounded replay scope in
[SOURCE_OPERATIONS.md](SOURCE_OPERATIONS.md). If rights change, stop acceptance and
review the permission before any retry. To stop the private path, stop connector
and worker invocations; preserve immutable receipts, quarantine and migration
history for review. No persistent service or migration is created by this runbook.
