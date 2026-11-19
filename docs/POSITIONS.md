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
| `ingestedAt` | Application ingestion time, separately supplied as strict UTC. It does not replace or refresh `observedAt`. |
| `timestampPrecision` | `MILLISECOND`, `SECOND`, `MINUTE`, `HOUR`, or `UNKNOWN`, as supported by source evidence. |
| `timestampUncertaintyMs` | Integer from 0 through one year in milliseconds, or `null` when clock uncertainty is unknown. Zero is an explicit zero-uncertainty claim. |
| `measurementKind` | `ADS_B`, `MLAT`, or `OTHER`. `OTHER` requires an explicit `measurementDetail`. |
| `latitude`, `longitude` | Finite decimal degrees. Latitude is in [-90, 90], longitude in [-180, 180]. |

Optional `identifierHints` may contain an ICAO24 address, callsign, or
source-local ID. They are hints only: callsigns and source-local IDs are not
globally stable, and this contract does not resolve temporal aircraft identity.

Optional measurements preserve provenance and units:

- `groundSpeedKnots` is ground speed in knots, never airspeed; a provider that
  supplies another unit must convert it in its adapter and document the
  conversion. `0` is valid.
- `trackDegrees` is clockwise degrees from north in [0, 360). It is not a
  magnetic heading. `0` is valid; `360` is rejected rather than silently
  rewritten to `0`.
- `altitude` is either `{ kind: "BAROMETRIC_FT", valueFt }` or
  `{ kind: "GEOMETRIC_FT", valueFt }`. The two altitude types are never
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

## Synthetic contract example

This example is for tests and documentation only; it is not a captured aircraft
position or a provider fixture.

```json
{
  "schemaVersion": 1,
  "sourceId": "src_synthetic-test",
  "sourceObservationId": "synthetic-position-1",
  "observedAt": "2026-11-19T11:00:00.000Z",
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
poll frequency, source health, storage, or current-position freshness.

Position freshness is independent from radio-message freshness. A delayed
position can be valid historical evidence without refreshing message status;
message status must never be derived from this contract. Any future current
position projection needs its own explicit age threshold and source-health
policy.

The contract records data shape, not data rights. A provider adapter still
requires a separate source decision, license/terms review, bounded quota policy,
and permitted fixture. See [source selection status](SOURCES.md#source-authorization-status).
