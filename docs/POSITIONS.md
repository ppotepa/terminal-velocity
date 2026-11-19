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
| `sourceObservationId` | Opaque source observation ID, scoped by `sourceId`; never derive it from coordinates or rounded time. |
| `observedAt` | Provider/receiver event time, strict UTC, normalized to milliseconds. |
| `observedAtBasis` | `SOURCE_TIMESTAMP`, `SOURCE_AGE_FROM_REFERENCE`, or `RECEIVER_TIMESTAMP`; makes derived source time explicit. |
| `sourceTimeReferenceAt` / `sourceAgeSeconds` | Required together only for `SOURCE_AGE_FROM_REFERENCE`. Preserve the provider reference time and age used to derive `observedAt = reference - age`; the parser validates that relation. |
| `ingestedAt` | Application ingestion time, separately supplied as strict UTC. It does not replace or refresh `observedAt`. |
| `timestampPrecision` | `MILLISECOND`, `SECOND`, `MINUTE`, `HOUR`, or `UNKNOWN`, as supported by source evidence. |
| `timestampUncertaintyMs` | Integer from 0 through one year in milliseconds, or `null` when clock uncertainty is unknown. Zero is an explicit zero-uncertainty claim. |
| `measurementKind` | `ADS_B`, `MLAT`, or `OTHER`. `OTHER` requires an explicit `measurementDetail`. |
| `latitude`, `longitude` | Finite decimal degrees. Latitude is in [-90, 90], longitude in [-180, 180]. |
| `quality` | Optional source-reported NIC, NACp, and containment radius in meters. Values are retained as quality facts and do not establish a guarantee. |

Optional `identifierHints` may contain an ICAO24 address, callsign, or
source-local ID. They are hints only: callsigns and source-local IDs are not
globally stable, and this contract does not resolve temporal aircraft identity.

Optional measurements preserve provenance and units:

- `groundSpeedKnots` is ground speed in knots, never airspeed; a provider that
  supplies another unit must convert it in its adapter and document the
  conversion. `0` is valid.
- `trackDegrees` is clockwise degrees from north in [0, 360). It needs a
  `trackKind` of `GROUND_TRACK` or `TRUE_HEADING`; the source can describe true
  heading while on the ground. `0` is valid; `360` is rejected rather than
  silently rewritten to `0`.
- `altitude` is either `{ kind: "BAROMETRIC_FT", valueFt }` or
  `{ kind: "GEOMETRIC_FT", valueFt }`, or `{ kind: "SURFACE", valueFt: null }`
  when the source explicitly reports “ground”. The altitude types are never
  collapsed.
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
  "altitude": { "kind": "BAROMETRIC_FT", "valueFt": 0 }
}
```

## Adapter and policy boundaries

`PositionAdapter<TRaw, TContext>` accepts provider-specific raw input and
application ingestion context, and returns a validated observation or typed
parse error. It must preserve a real provider observation ID, measurement
method, source timestamp precision, and uncertainty. The contract does not
define storage or current-position freshness.

## Private adsb.lol position adapter

Stage 4 S4-02 adds a one-shot HTTPS transport and an opt-in poller for the
adsb.lol point/radius endpoint. The adapter maps `seen_pos` to an age-derived
event timestamp and reports unknown precision and uncertainty. Snapshot
coverage is `SAMPLED` with `completeness: UNKNOWN`; absent rows do not mean
aircraft absence. Source health reports transport connectivity separately from
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
API route, map, or automatic poller wiring. A later composition root must opt in
explicitly and keep any preview private until publication policy is approved.

Position freshness is independent from radio-message freshness. A delayed
position can be valid historical evidence without refreshing message status;
message status must never be derived from this contract. Any future current
position projection needs its own explicit age threshold and source-health
policy.

The contract records data shape, not data rights. A provider adapter still
requires a separate source decision, license/terms review, bounded quota policy,
and permitted fixture. See [source selection status](SOURCES.md#source-authorization-status).
