# Contracts between modules and the interface

The contracts below are a proposal for the target system. `reference/` implements internal types for selected rules, not the entire network serialization layer. Example JSON Schemas for three event families are in `../contracts/state-events.schema.json`.

## 1. An event is a committed fact

| Event family | Producer | Consumers | Reason for publication |
|---|---|---|---|
| `communications.reception.accepted.v1` | communications | receiver health, decode processing | A new confirmed reception was retained |
| `communications.message.revised.v1` | communications | correlation, publication | A new interpretation or complete message was produced |
| `fleet.identity.revised.v1` | fleet-identity | correlation index, reprocess planner | A significant identifier association changed |
| `tracking.session.revised.v1` | flight-tracking | flight-link correlation | A flight session or its boundaries changed |
| `correlation.aircraft-link.revised.v1` | correlation | publication, audit | An aircraft association was resolved or corrected |
| `correlation.flight-link.revised.v1` | correlation | publication, session reads | The flight session was resolved separately |
| `publication.message-contribution.replaced.v1` | publication | availability, message timeline | The full new state of a permitted contribution in the given scope |
| `availability.aircraft.changed.v1` | availability | map projection, scope notifications | The aircraft status result changed |
| `map.projection.changed.v1` | read-model writer | delivery | A versioned view delta was produced |

We do not publish a separate durable event merely because `normalizeString`, `computeHash` or one comparison rule ran. These are local steps and functions. An event is emitted after a meaningful commit boundary.

## 2. Envelope and revisions

The example envelope contains eventId, type, schemaVersion, stream key/revision, occurredAt, recordedAt, causationId, traceId and a typed payload.

| Field | Guarantee |
|---|---|
| `eventId` | Stable when retrying the same fact; different for a new revision |
| `schemaVersion` | Wire structure version, independent of the algorithm version |
| `stream.key` | Ordering scope, such as message or `(scope,message)` |
| `stream.revision` | Monotonic revision only within this stream |
| `occurredAt` | Time of the domain decision or fact, not necessarily the RF transmission time |
| `recordedAt` | Time of the outbox write |
| `causationId` | The cause, if it was another event |
| `traceId` | Diagnostics; not a business identifier for the data |

The `observedAt` used for freshness is in the contribution payload. We do not substitute occurredAt or recordedAt for it. Events in these examples carry full replacement state. The `previous` history supports auditing; the projector retracts the state actually stored locally.

### Additional invariants beyond JSON Schema

- The stream key is derived from the appropriate domain key, not an arbitrary label.
- `contributionRevision == stream.revision` in the published contribution family.
- An existing eventId cannot receive a different payload.
- A higher revision can replace an older one only for the same key.
- `RECENT` requires an existing, permitted and sufficiently fresh contribution.
- Dates and thresholds comply with the applicable freshnessPolicyVersion.
- A UUID/string from JSON must pass through the domain ID factory.
- The recipient is authorized for the given visibilityScope.
- Grants and assignments are inputs to a separate contributionRevision, not a shared numeric scale.

JSON Schema rejects invalid structure. It does not perform authorization or prove that an aircraftId actually exists.

## 3. Errors require different responses

| Result | Meaning | Response |
|---|---|---|
| `UNMATCHED` | Rules completed correctly, but the evidence was insufficient | Retain the fact; reprocess when new knowledge becomes available |
| `AMBIGUOUS` | More than one candidate | Do not select randomly; display or persist the reason |
| `CONFLICTED` | Strong evidence or the catalog is contradictory | Stop automatic matching and retain the evidence |
| `CANDIDATE_SET_INCOMPLETE` | The index or query did not supply complete data | Retry/backfill; no new domain decision |
| `VERSION_CONFLICT` | Another operation committed a newer change | Read the newer state and deliberately reevaluate |
| `INVALID_INPUT` | Invalid contract or value | Reject/quarantine; no retry without correction |
| `TEMPORARY_SOURCE_FAILURE` | Provider or request budget unavailable | Controlled retry with a deadline |
| `ACCESS_REVOKED` | The scope is no longer accessible | Block/revoke access and invalidate the old resume token |

## 4. REST: separate aircraft and flight resources

```http
GET /api/v1/map/aircraft?bbox=...&bearer=VDL2&freshness=RECENT
GET /api/v1/aircraft/:aircraftId
GET /api/v1/aircraft/:aircraftId/messages?cursor=...&limit=50
GET /api/v1/flight-sessions/:flightSessionId
GET /api/v1/flight-sessions/:flightSessionId/messages?cursor=...
GET /api/v1/flight-sessions/:flightSessionId/observed-track
GET /api/v1/messages/:messageId
GET /api/v1/messages/:messageId/association-explanation
GET /api/v1/stations
POST /api/v1/feeder/deliveries
```

A panel opened from an aircraft shows that aircraft's messages by default. Selecting a specific session narrows the results; a missing sessionId does not remove correctly associated messages from the aircraft view.

`messages` returns `dataLevel` and permitted representations (`summary`, `decoded`, `raw available`, `withheld`). The endpoint does not advertise a raw frame if the source did not provide one. A history cursor is bound to the filter, permission scope and stable sort key `(observedAt,messageId,revision)`. History corrections use revisions or re-fetching; we do not promise an immutable snapshot across days of pagination without an explicit snapshot token.

Feeder uploads use eventId/source epoch and a verified token. An acceptance ACK means “delivery durably accepted,” not “frame successfully decoded and already published.” Processing status is a separate contract.

## 5. WebSocket

Subscription request:

```json
{
  "type": "subscribe.viewport",
  "requestId": "req-17",
  "bbox": [14.0, 49.0, 24.5, 55.0],
  "filters": { "bearers": ["VDL2"], "freshness": ["RECENT", "STALE"] },
  "resumeToken": null
}
```

A snapshot carries a subscriptionId, generation and opaque cursor. Large map snapshots may be chunked; the client applies the complete snapshot only after `snapshot.end`.

```json
{
  "type": "delta.batch",
  "subscriptionId": "sub-17",
  "generation": "view-generation-2",
  "fromCursor": "opaque-cursor-a",
  "toCursor": "opaque-cursor-b",
  "changes": [
    { "kind": "remove", "aircraftId": "aircraft-A", "reason": "OUTSIDE_VIEWPORT" }
  ]
}
```

A position delta must not independently erase frame metadata. Prefer an explicit, complete `AircraftMapView` for an upsert, or versioned fragments with explicitly independent revisions. An empty/null payload must not have multiple hidden meanings.

Each cursor corresponds to a specific scope and filter set. The server does not trust a client-supplied scope; it derives the scope from permissions. After permissions change, the token is invalid even if its time range remains within the log retention window.

## 6. Version changes

Introduce a new event schema using expand/contract: consumers support old and new versions during migration, the producer switches in a controlled manner, and old-version support is removed after the replay horizon expires. If an upcaster cannot reconstruct missing semantics, the event goes through an explicit migration path; it does not create invented data.

A policyVersion change may require reprocessing without changing the JSON schema. A projection change starts a new generation, rebuilds from scratch and cuts over after a checkpoint. These are three distinct processes with separate responsibilities.
