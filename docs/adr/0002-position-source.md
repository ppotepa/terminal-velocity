# ADR 0002: Private position source

- **Status:** APPROVED_PRIVATE_ONLY
- **Decision date:** 2026-11-19
- **Documentation reviewed:** 2026-11-19
- **Decision owner:** Repository owner (`ppotepa`)
- **Implementation branch:** `feature/s4-02-adsblol-position-source`
- **Provider:** adsb.lol open-data API
- **Approved use:** private/local position ingestion and display for development only
- **Public use:** not approved by this project decision; blocked until Stage 5 publication controls and Stage 46 licensing review

## Decision

Use the documented HTTPS point/radius API for a private local preview:

```text
GET https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{radiusNm}
```

The provider's OpenAPI allows latitude [-90, 90], longitude [-180, 180], and
radius 0–250 nautical miles. This application caps the radius at **50 NM**, uses
a **10-minute minimum poll interval**, and limits one running process to **200
requests in any rolling 24 hours**. The unauthenticated tier is documented as
500 requests/day/IP; the smaller local budget leaves room for other use of the
host address. The API documentation pages disagree about whether the daily
window resets at midnight UTC or is a fixed 24-hour bucket. We will not assume a
reset time: the local budget uses a rolling window and the 10-minute interval.
HTTP 429 must honor `Retry-After` and must not trigger an immediate retry.
Every live transport in one Node process shares the default budget. Only the
explicit fixture transport factory accepts an isolated budget and a prebuilt
synthetic response or failure mode; it cannot accept a fetch function. The live
factory cannot replace or weaken the process policy, and its budget uses the
real process clock even when a caller injects a clock for response timestamps.
Live requests have an 8-second maximum timeout and a 1 MB maximum response
body, including when callers supply options. The batch reports that
live policy. This in-memory limit does not coordinate multiple processes or
other clients sharing one IP address, so an operator must account for those
before enabling more than one preview process.

No key is required for the documented unauthenticated tier. API keys are
optional for higher tiers; no key/account is configured or owned for this
project. There is no live-network dependency in CI. Constructing a transport or
poller does not request data. Polling starts only after an explicit local caller
calls `start` and stops on an explicit abort or non-retryable provider error.

## Contract mapping and limits

| Provider field | Canonical value / handling |
|---|---|
| top-level `now` | Provider snapshot-generation reference time in Unix milliseconds. |
| `seen_pos` | Seconds since the most recent position update. Derive `observedAt = now - seen_pos` and set `observedAtBasis: SOURCE_AGE_FROM_REFERENCE`, `sourceTimeReferenceAt: now`, `sourceAgeSeconds: seen_pos`, precision `UNKNOWN`, uncertainty `null`. The provider does not document a timestamp error bound. |
| `hex` | ICAO24 only when exactly six hex digits; `~`/non-ICAO addresses are source-local hints. Without an independent trusted identity decision, positioned rows with only these hints are counted as unresolved and omitted from canonical observations. An ICAO24 is a hint, not temporal identity confirmation. |
| `type` | `mlat` maps to `MLAT`; `adsb_*` maps to `ADS_B`; other declared source types map to `OTHER` with the source type preserved in `measurementDetail`. |
| `lat`, `lon` | Decimal degrees. A row with both absent/null has no position and is skipped; a half-present or invalid coordinate rejects the snapshot. A positioned row without a resolvable identity is counted separately and omitted. Missing aircraft are never treated as negative observations. |
| `alt_baro`, `alt_geom` | Barometric and geometric values in feet remain separately tagged when numeric. `alt_baro: "ground"` maps to the explicit `SURFACE` altitude kind. If a numeric `alt_geom` is simultaneously present, it is omitted because canonical schema v1 forbids a surface state combined with numeric altitude; a synthetic regression test fixes this precedence. |
| `gs`, `track` | Ground speed in knots and true track degrees. `track` is true heading while on the ground; preserve `trackKind` accordingly. Null and zero remain distinct. |
| `nic`, `nac_p`, `rc` | Preserve provider-reported NIC/NACp and containment radius in meters as quality metadata; no accuracy guarantee is inferred. |
| `now` + `hex` | The API has no per-position delivery ID. Create a deterministic local observation key from this exact snapshot reference and the aircraft address; do not hash coordinates or round time. This identifies a snapshot row, not an upstream immutable event. |

The response envelope is `ac`, `ctime`, `msg`, `now`, `ptime`, and `total`.
The API documents `total` as `ac.length`. Reject a mismatch instead of
presenting a truncated snapshot as complete. Queries cover only the selected
circle and the provider's shared receiver network; coverage is sampled and
best-effort, not station-complete or global. The endpoint is not a bounding-box
query. The provider disclaims guaranteed accuracy, timeliness, completeness,
reliability, and availability.

The returned batch includes the configured request limits and declares
`coverage.completeness: UNKNOWN`. The poller tracks `NOT_STARTED`, `CONNECTING`,
`CONNECTED`, `DEGRADED`, and `STOPPED` transport states, the last successful
fetch time, consecutive failures, and the last error category. Those health
fields do not refresh or override per-observation source time.

The live transport requires an explicit reviewed `PositionSourceCapabilities`
configuration for its source ID. Each positioned row passes through
`acceptPositionObservation`, which revalidates the canonical observation and
checks its measurement kind and time basis against that configuration. A
provider type mapped to `OTHER` is rejected when `OTHER` is outside the
configured capabilities. The private preview currently allows `ADS_B`, `MLAT`,
and `OTHER` with `SOURCE_AGE_FROM_REFERENCE`; the configured capability set is
local to that preview and does not grant public publication rights. Provider
numeric fields are interpreted only in the documented units. Unit-bearing
objects or strings in those fields are rejected; a bare but plausible number
in an undocumented unit cannot be detected from the response alone.

The explicit `npm run positions:preview -- --live --lat 52.52 --lon 13.405 --radius-nm 10`
command starts an independent position poller and a JSON preview at
`127.0.0.1:3001/positions`. It serves only canonical batches, binds only to
loopback, retains the latest batch in memory, and drops it on SIGINT or SIGTERM.
The route is private to this separate process; the demo API and message
ingestion do not start it. Use `--port` to select another local port. Starting
the process makes a live provider request, so it is an explicit local action
subject to the source decision and quota. This command has not been run against
the live provider in the current review iteration.

No source data is persisted by S4-02. Tests use synthetic fixtures shaped from
the OpenAPI contract; no live aircraft payload is stored in Git. On 2026-11-19,
manual bounded checks queried a 1 NM circle (zero positioned observations) and
a 10 NM circle (seven observations passed canonical validation). The command
printed only aggregate counts; response rows were not logged, committed, or
persisted. These checks are not a completeness or accuracy claim.

## Rights and scope

The API and public data are stated to be under the [Open Database License
(ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/). This authorizes the
planned local private use subject to the license; it does not clear every
possible right in individual content. ODbL requires notices when a database or
derivative database is publicly conveyed; public use of a produced work needs a
source/license notice, and publicly used derivative databases are subject to
share-alike and access conditions. Do not expose a public endpoint, map, API,
or data export under this decision. Issue #46 must review public licensing,
attribution, privacy, and takedown requirements before any publication change.

| Required decision field | Recorded value |
|---|---|
| `provider` | adsb.lol |
| `transport` | HTTPS GET point/radius endpoint above |
| `dataLevel` | Aggregated aircraft position snapshot; per-row measurement type may be ADS-B, MLAT, or another provider-declared source |
| `approvedUse` | `internal` private/local preview only |
| `contract/terms URL` | Links below |
| `verifiedOn` | 2026-11-19 |
| `quota` | 500 unauthenticated requests per IP/day per OpenAPI; application max 200 per rolling 24h/process and 10-minute minimum interval; 429 `Retry-After` required |
| `fieldRights` | Provider states API database is ODbL 1.0. No broad statement about other rights in individual content is inferred. |
| `retention` | No persistence in S4-02; in-memory snapshot only. Any later durable retention requires issue #46 policy. |
| `credentialOwner` | None; unauthenticated endpoint. No API key configured. |
| `redactedFixtureSource` | Synthetic examples constructed from the official OpenAPI schema; no provider payload or aircraft record committed |
| `goNoGo` | **GO** for private/local adapter and manual bounded verification; **NO-GO** for public use or deployment |

## Evidence reviewed

- [adsb.lol API usage and open-data license](https://www.adsb.lol/docs/open-data/api) — API access, ODbL, quota tiers, and 429 handling.
- [adsb.lol OpenAPI specification](https://api.adsb.lol/api/openapi.json) — endpoint parameters, envelope, field units, source type, position age, and declared errors.
- [adsb.lol privacy and license](https://www.adsb.lol/docs/privacy-license) — as-is accuracy/timeliness disclaimer and provider privacy details.
- [Open Data Commons ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) — public-use notices, share-alike, and access conditions.

## Unblock/revocation

Private/local access is approved while the provider continues to publish the
API and ODbL terms. Disable polling on HTTP 401/403 or a provider license change
until re-reviewed. Public use requires issue #46 approval, Stage 5 publication
controls, license notices, compatible terms for any derivative database, and a
reviewed issue-specific go/no-go amendment. The absence of an aircraft from a
snapshot must never be interpreted as no transmission or no aircraft.
