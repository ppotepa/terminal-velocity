# Position observation contract

Stage 4 schema v1 defines a provider-neutral position fact. It does not read a
provider format, store observations, resolve aircraft identity, or imply that a
map is available. Provider adapters must document their wire schema and map
only fields the source actually supplies.

## Schema v1

`@airframes/backend/flight-tracking` exports `parsePositionObservation` and the
`PositionAdapter<TRaw>` port. The parser accepts `unknown`, rejects unknown
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
| `identifierHints.icao24` or `confirmedAircraftId` | An ICAO24 address or an application aircraft ID confirmed by an upstream identity decision is required. The observation ID is only a delivery identity. |

`identifierHints` may also contain a callsign or source-local ID. These alone
are not stable aircraft identities. Without ICAO24 or `confirmedAircraftId`,
the parser returns `UNRESOLVED_AIRCRAFT_IDENTITY`; malformed confirmed IDs
return `INVALID_POSITION_IDENTIFIER`. A confirmed ID requires a separate
`PositionIdentityDecision` supplied by a trusted upstream resolver. The decision
must be confirmed, name the same source delivery and aircraft ID, and identify
the same ICAO24 when the observation carries one. An unsupported claim returns
`UNSUPPORTED_CONFIRMED_IDENTITY`; a missing or different decision ICAO24 returns
`CONFLICTING_POSITION_IDENTIFIERS`. Provider wire data must never supply the
decision. The parser checks consistency with the supplied decision; it cannot
establish that the caller actually obtained that decision from an authoritative
resolver. Until such a resolver exists, omit `confirmedAircraftId` and retain
ICAO24 as a hint only. Revalidating a serialized observation with a confirmed
ID requires the trusted decision again.

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
- Schema v1 has one altitude slot. A payload containing both barometric and
  geometric values must be rejected at the provider boundary; passing both as
  an array returns `MULTIPLE_ALTITUDE_MEASUREMENTS`. An adapter must not select
  one silently. A later schema version is needed to retain both in one fact.
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

`PositionAdapter<TRaw>` accepts provider-specific raw input and application
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
