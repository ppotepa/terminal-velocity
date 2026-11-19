# Demonstrator API — v0.1

Local address: `http://127.0.0.1:3000`. This stage has no authentication. The server binds only to loopback, and all aircraft identifiers and positions come from fixtures.

## Reads

| Method and path | Result |
|---|---|
| `GET /healthz` | Demo mode and selected storage; PostgreSQL readiness is checked against the database |
| `GET /api/v1/aircraft` | Synthetic aircraft with positions and message availability |
| `GET /api/v1/aircraft/:id` | One aircraft and its current availability |
| `GET /api/v1/aircraft/:id/messages` | Messages matched to the specified aircraft |
| `GET /api/v1/messages/:id` | One message and a safe decision DTO |

Data reads use the `{ "data": ... }` envelope. A missing object returns HTTP 404. An aircraft without messages returns an empty list. Positions do not simulate movement; `position.observedAt` is a fixed timestamp stored in the fixture.

Storage selection is a process setting: `STORAGE_DRIVER=memory` (default) or `STORAGE_DRIVER=postgres` with `DATABASE_URL`. See [POSTGRES.md](POSTGRES.md) for migrations and credentials. Health returns `storage: "memory"` or `storage: "postgres"`; an unreachable PostgreSQL database returns HTTP 503 with `status: "unavailable"`. A healthy response uses `status: "ok"`. Both modes remain `mode: "demo"`.

## Message ingestion

`POST /api/v1/demo/messages`, `Content-Type: application/json`.

The following illustrates the request shape. Run `npm run example` for a working example using the current time and a fixture identifier:

```json
{
  "messageId": "msg_example-1",
  "observedAt": "2026-11-18T12:00:00.000Z",
  "bearer": "VDL2",
  "text": "Synthetic demonstration message",
  "icao24": "D00001"
}
```

Required fields: `messageId`, `observedAt`, `bearer`, and `text`. Optional identifiers: `icao24`, `registration`, and `callsign`. The absence of a strong identifier does not establish a match. A callsign alone does not confirm aircraft identity. Supported bearers: `VHF_ACARS`, `VDL2`, `HFDL`, and `SATCOM`.

The client cannot supply candidates, `publicEligible`, entitlement revisions, or a visibility scope. Unknown fields are rejected. `messageId` starts with `msg_`, followed by 1–64 ASCII letters, digits, or `-` characters. Observation time must be a valid UTC timestamp; future observations are rejected.

A new message returns HTTP **201**; an identical replay returns **200** with `created: false`. Response body:

```json
{
  "data": {
    "created": true,
    "message": {
      "messageId": "msg_example-1",
      "observedAt": "2026-11-18T12:00:00.000Z",
      "bearer": "VDL2",
      "text": "Synthetic demonstration message",
      "correlation": {
        "outcome": "MATCHED",
        "aircraftId": "ac_demo-001"
      }
    }
  }
}
```

This example uses the first synthetic aircraft. Outcomes are `MATCHED`, `UNMATCHED`, `AMBIGUOUS`, and `CONFLICTED`. Only `MATCHED` identifies an `aircraftId`; other outcomes use `null`. An unresolved message remains accessible by its own ID and does not give an aircraft a green availability indicator.

Changing the facts of an existing message returns **409 MESSAGE_CONFLICT**. PostgreSQL mode retains canonical facts and idempotency across process restarts and serializes competing first writes from separate connections. Memory-mode idempotency lasts until restart. Decision history and corrections are supported by the core PostgreSQL adapter; an HTTP correction endpoint remains a separate use case.

In PostgreSQL mode, HTTP 201 acknowledges the transaction containing facts, decision, and outbox event. Message-by-ID reads are immediately available after that commit. Aircraft availability is projected asynchronously and may lag ingestion or correction; clients can refresh it. Replaying the same request after a lost response resolves an uncertain commit outcome without creating a second message.

Memory mode stores at most **500 messages**. PostgreSQL mode retains accepted messages and returns at most the **500 newest messages** per aircraft, ordered by observation time descending and message ID ascending. There is no automatic deletion or paginated history endpoint yet. The `text` field is limited to **4096 UTF-16 code units** in both modes; durable retention remains an operational policy to implement before public deployment.

## Message availability

`availability.freshness` uses the age of the latest eligible message:

| Observation age | Status |
|---|---|
| `0 ≤ age < 10 min` | `RECENT` |
| `10 min ≤ age < 60 min` | `STALE` |
| `age ≥ 60 min` or no contribution | `NONE` |

Backfill uses `observedAt`, not the time of the POST request. `lastMessageAt` may remain set for a historical message even when freshness is `NONE`. Demo coverage is `UNKNOWN` and real feed health is `DISCONNECTED`; no live transmission source is connected.

## Errors

Request errors use `{ "error": { "code": "...", "message": "..." } }`. The health endpoint is an exception: a failed database connectivity check returns HTTP 503 with `{ "data": { "status": "unavailable", "mode": "demo", "storage": "postgres" } }`. Connectivity does not establish that the delivery queue is caught up or every projector is healthy.

| HTTP | Meaning |
|---|---|
| 400 | Invalid JSON, shape, ID, timestamp, or unsupported parameters |
| 404 | Unknown route or missing object |
| 405 | Unsupported method for an existing route |
| 409 | Different facts under an existing message ID |
| 413 | Request body exceeds 16 KiB |
| 415 | Unsupported Content-Type |
| 429 | The demonstrator's in-memory collection limit has been reached |
| 500 | Internal error, without exposing a stack trace |
| 503 | Incomplete candidate data, or unavailable PostgreSQL connectivity on `/healthz` |

API v0.1 has no pagination or spatial filters. Their contracts will be introduced with the map read model. PostgreSQL aircraft message lists use the documented 500-record bound. Unsupported parameters are rejected rather than silently ignored.
