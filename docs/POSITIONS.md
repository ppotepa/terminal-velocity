# Position observation contract

Stage 4 schema v1 defines a provider-neutral position fact. It does not read a
provider format, store observations, resolve aircraft identity, or imply that a
map is available. Provider adapters must document their wire schema and map
only fields the source actually supplies.

## Schema v1

`@airframes/backend/flight-tracking` exports `parsePositionObservation` and the
`PositionAdapter<TRaw, TContext>` port. The parser accepts `unknown`, rejects unknown
fields/accessors, returns typed failures, and creates immutable canonical
values. It recognizes the canonical v1 shape only; it is not an ADS-B or MLAT
provider parser.

Each observation requires:

| Field | Meaning |
|---|---|
| `schemaVersion` | Canonical schema version, currently `1`. |
| `sourceId` | Application-assigned `src_…` source configuration ID. |
| `sourceObservationId` | Opaque source observation ID, scoped by `sourceId`; never derive a durable key from coordinates or rounded time. Preview adapters may use explicitly ineligible keys. |
| `observedAt` | Provider/receiver event time, strict UTC, normalized to milliseconds. |
| `observedAtBasis` | `SOURCE_TIMESTAMP`, `SOURCE_AGE_FROM_REFERENCE`, or `RECEIVER_TIMESTAMP`; makes derived source time explicit. |
| `sourceTimeReferenceAt` / `sourceAgeSeconds` | Required together only for `SOURCE_AGE_FROM_REFERENCE`. Preserve the provider reference time and age used to derive `observedAt = reference - age`; the parser validates that relation and rejects a reference later than ingestion plus declared clock uncertainty. |
| `ingestedAt` | Application ingestion time, separately supplied as strict UTC. It does not replace or refresh `observedAt`. |
| `timestampPrecision` | `MILLISECOND`, `SECOND`, `MINUTE`, `HOUR`, or `UNKNOWN`, as supported by source evidence. |
| `timestampUncertaintyMs` | Integer from 0 through one year in milliseconds, or `null` when clock uncertainty is unknown. Zero is an explicit zero-uncertainty claim. |
| `measurementKind` | `ADS_B`, `MLAT`, or `OTHER`. `OTHER` requires an explicit `measurementDetail`. |
| `latitude`, `longitude` | Finite decimal degrees. Latitude is in [-90, 90], longitude in [-180, 180]. |
| `quality` | Optional source-reported NIC, NACp, and containment radius in meters. Values are retained as quality facts and do not establish a guarantee. |
| `identifierHints.icao24` or `confirmedAircraftId` | An ICAO24 address or an application aircraft ID confirmed by an upstream identity decision is required. The observation ID is only a delivery identity. |

`identifierHints` may also contain a callsign or source-local ID. These alone
are not stable aircraft identities. Without ICAO24 or `confirmedAircraftId`,
the parser returns `UNRESOLVED_AIRCRAFT_IDENTITY`; malformed confirmed IDs
return `INVALID_POSITION_IDENTIFIER`. A confirmed ID requires an
`identityEvidence: { resolverId, evidenceRef }` object and a separate
`PositionIdentityDecision` supplied by a trusted upstream resolver. The decision
must be confirmed, name the same source delivery, aircraft ID, resolver and
evidence reference, and identify the same ICAO24 when the observation carries
one. Missing, malformed or conflicting evidence, or an unsupported claim, returns
`UNSUPPORTED_CONFIRMED_IDENTITY`; a missing or different decision ICAO24 returns
`CONFLICTING_POSITION_IDENTIFIERS`. Provider wire data must never supply the
decision. The parser checks consistency with the supplied decision; it cannot
establish that the caller actually obtained that decision from an authoritative
resolver. Until such a resolver exists, omit `confirmedAircraftId` and retain
ICAO24 as a hint only. Revalidating a serialized observation with a confirmed
ID requires the trusted decision again. The evidence reference is an opaque
resolver-scoped decision ID; it is provenance, not proof that a caller is trusted.

Optional measurements preserve provenance and units:

- `groundSpeedKnots` is ground speed in knots, never airspeed; a provider that
  supplies another unit must convert it in its adapter and document the
  conversion. `0` is valid.
- `trackDegrees` is clockwise degrees from north in [0, 360). It needs a
  `trackKind` of `GROUND_TRACK` or `TRUE_HEADING`; the source can describe true
  heading while on the ground. `0` is valid; `360` is rejected rather than
  silently rewritten to `0`.
- `altitudes` is an array with one or two tagged values:
  `{ kind: "BAROMETRIC_FT", valueFt }`, `{ kind: "GEOMETRIC_FT", valueFt }`, or the
  sole value `{ kind: "SURFACE", valueFt: null }` when the source explicitly
  reports ground. Barometric and geometric heights can coexist and survive
  serialization. Duplicate kinds, an empty array, a surface value alongside
  another altitude, and unknown units are rejected. Adapters must convert
  source units explicitly before parsing.
- For each optional measurement, an omitted field means the source omitted the
  field, `null` means the source explicitly reported it unavailable, and a
  numeric zero remains a reported measurement. No missing value is filled
  with zero.

All timestamps must be real UTC calendar values ending in `Z`; offsets and
impossible dates are rejected. An observation later than ingestion is rejected
unless its positive difference is covered by the declared source timestamp
uncertainty. When uncertainty is unknown, future observations are rejected.
Delayed/backfilled observations are accepted while preserving their older
`observedAt`; ingestion does not make historical data fresh.

For a source that reports an age rather than a direct position timestamp, an
adapter records both the source's reference timestamp and its age, sets
`observedAtBasis` to `SOURCE_AGE_FROM_REFERENCE`, and derives the event time
from those values. The basis does not assert a precision or error bound the
provider has not documented.

## Synthetic contract example

This example is for tests and documentation only; it is not a captured aircraft
position or a provider fixture.

```json
{
  "schemaVersion": 1,
  "sourceId": "src_synthetic-test",
  "sourceObservationId": "synthetic-position-1",
  "observedAt": "2026-11-19T11:00:00.000Z",
  "observedAtBasis": "SOURCE_TIMESTAMP",
  "ingestedAt": "2026-11-19T11:00:01.000Z",
  "timestampPrecision": "SECOND",
  "timestampUncertaintyMs": 500,
  "measurementKind": "ADS_B",
  "latitude": 0,
  "longitude": 0,
  "identifierHints": { "icao24": "A0B1C2" },
  "groundSpeedKnots": 0,
  "trackDegrees": null,
  "altitudes": [{ "kind": "BAROMETRIC_FT", "valueFt": 0 }, { "kind": "GEOMETRIC_FT", "valueFt": 100 }]
}
```

## Adapter and policy boundaries

`PositionAdapter<TRaw, TContext>` accepts provider-specific raw input and application
ingestion time, and returns a validated observation or typed parse error. It
must preserve a real provider observation ID, measurement method, source
timestamp precision, and uncertainty. The contract does not define retries,
poll frequency, source health, or storage. `acceptPositionObservation` is the
source boundary: it revalidates the adapter result against canonical v1, checks
that its ingestion time matches the supplied context, and checks its source ID,
measurement kind, and time basis against `PositionSourceCapabilities`. A source
configured for ADS-B cannot silently relabel an MLAT position, and an adapter
cannot claim an undeclared receiver time basis. Missing coordinates fail
validation; the adapter must not fill them from a prior position. A future
provider adapter must map its own units and null semantics explicitly before
calling this boundary.
The acceptance context carries the trusted identity decision separately from
raw provider input, and acceptance rechecks it even if an adapter returns a
prebuilt canonical object.

`positionFreshnessPolicy` requires a positive `currentWithinMs` threshold.
`classifyPositionFreshness` compares **observedAt**, not `ingestedAt`, with
the current instant. It returns `CURRENT` only when the oldest plausible event
time is within the threshold, `STALE` only when the newest plausible event
time is outside it, and `UNKNOWN` when the uncertainty interval crosses the
threshold, uncertainty is absent, the clock is ahead, or no position exists.
The interval includes the declared clock uncertainty plus a conservative full
precision unit (1 ms, 1 second, 1 minute or 1 hour) around `observedAt`.
`UNKNOWN` precision cannot produce `CURRENT` or `STALE`. Thus an hour-precision
position cannot appear current merely because its clock uncertainty is zero.
This is an event-age rule only; it does not assert source health, identity
resolution, visibility rights, or map suitability. A later projection must
combine those separate checks before displaying a current position.

Position freshness is independent from radio-message freshness. A delayed
position can be valid historical evidence without refreshing message status;
message status must never be derived from this contract. Neither the position
parser nor its freshness rule writes a communication fact or availability
projection.

The contract records data shape, not data rights. A provider adapter still
requires a separate source decision, license/terms review, bounded quota policy,
and permitted fixture. See [source selection status](SOURCES.md#source-authorization-status).

## Private adsb.lol position adapter

Stage 4 S4-02 adds a one-shot HTTPS transport and an opt-in poller for the
adsb.lol point/radius endpoint. The adapter maps `seen_pos` to an age-derived
event timestamp and reports unknown precision and uncertainty. Snapshot
coverage is `SAMPLED` with `completeness: UNKNOWN`; absent rows do not mean
aircraft absence. Positioned rows with only source-local identifiers are counted
as unresolved and omitted from canonical observations. Source health reports transport connectivity separately from
the timestamp and age of each observation.

The transport constructor does not start network activity. Its caller supplies
a validated center and radius; the adapter caps the radius at 50 NM, permits no
more than one request every 10 minutes, and shares a 200-request rolling
24-hour process budget by default. Response time is limited to 8 seconds and
1 MB. The poller starts only when its caller invokes `start`, honors
`Retry-After`, caps exponential backoff at one hour (or longer if the provider
requests a longer delay), and aborts an in-flight request or wait on `stop`.
These limits support a private/local preview only under
[`adr/0002-position-source.md`](adr/0002-position-source.md); they do not
authorize public display or deployment.

The provider response fixture is synthetic and offline. S4-02 adds no database,
map, or automatic poller wiring. The explicit private preview command is the
composition root for this adapter:
`npm run positions:preview -- --live --lat 52.52 --lon 13.405 --radius-nm 10`.
It binds to `127.0.0.1` only and
serves the latest canonical batch at `/positions` in memory. It does not start
with the demo API or messages command. A later issue owns persistence and
publication controls. The provider's geographic circle is checked for every
positioned row; an out-of-query-area row rejects the snapshot.

## Durable source-fact identity for issue #16

The private PostgreSQL writer accepts only IDs of the form
`epoch:<source-epoch>:<measurement-id>`. The source epoch must change whenever
the upstream namespace can reuse measurement IDs, including a receiver reset or
provider ID rollover. The final component must identify one genuine measurement
within that epoch. The application source ID scopes the whole key. A connector
must document where both components come from and establish that retries of the
same measurement carry the same key before it is connected to this writer.
Coordinates, ICAO24, an aircraft snapshot timestamp, and fetch time do not
establish measurement identity. Independent facts with identical coordinates or
timestamps need distinct measurement IDs. The current adsb.lol v2 snapshot
exposes no suitable measurement ID; its `preview:` keys are deliberately rejected
by the durable writer. It remains an in-memory preview only. Synthetic tests
use explicit epoch and measurement IDs without asserting that adsb.lol provides
this guarantee.

On a repeated key, the writer compares measurement facts and returns the first
stored observation and event ID. A later `ingestedAt` or delivery reference is
retry metadata and does not change the stored receipt or emit a second event.
Changed coordinates, event time, quality, source evidence, identity hints or
other measurement fields produce `SOURCE_OBSERVATION_CONFLICT`. This comparison
does not turn a provider's unstable snapshot key into a genuine measurement ID.
