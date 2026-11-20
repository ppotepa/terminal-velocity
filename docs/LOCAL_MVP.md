# Local backend MVP

## Start

From the repository root:

```sh
docker compose up -d mongo
docker compose ps
cd backend
/root/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.26.11.linux-amd64/bin/go run ./cmd/server
```

The API binds to `127.0.0.1:8080`. Set `TV_SYNTHETIC_MODE=true` before starting the process to enable the bounded local callsign fixture source. It only runs queries derived from active selected WatchRules, and it produces labeled synthetic observations; real providers remain inactive. MongoDB is published only on `127.0.0.1:27017`; its data remains in the ignored `data/mongo/` directory. Stop the server with Ctrl-C and MongoDB with `docker compose down`.

## Verified local routes

- `GET /api/health` reports Mongo readiness.
- `/api/v1/watch-rules` supports persisted WatchRule CRUD.
- `GET /api/v1/sources` reports OpenSky, the Airframes crawler, and Airframes API as inactive. With `TV_SYNTHETIC_MODE=true`, it also reports the labeled synthetic fixture source.
- `/api/v1/decoders` lists built-in decoder descriptors and Mongo-backed settings; config updates use `If-Match` revisions.
- `POST /api/v1/decoders/{decoderId}/preview` decodes a supplied bounded payload without persisting it.
- `/api/v1/map/snapshot`, aircraft/flight list routes, `/api/v1/flights/{id}/track`, and message list/detail routes are mounted. Synthetic mode creates persisted, source-labeled positions and messages only from active WatchRules.
- `/api/v1/alert-rules` and `/api/v1/alert-events` expose persisted alert rule CRUD, history and acknowledgement.
- `GET /api/v1/events` serves SSE heartbeats and `snapshot_required` for stale cursors. Synthetic mode publishes position, message, decoder and alert events.

Run the reproducible smoke checks from the repository root while Mongo and the API are running:

```sh
./scripts/demo/smoke.sh
```

The script creates and removes a temporary country-entry alert and active synthetic WatchRule, observes the fixture route cross from the UK into France, then verifies the persisted crossing alert, source-labeled track, matched/decoded message list/detail, SSE updates, decoder preview and stale-cursor snapshot recovery. Start the server with `TV_SYNTHETIC_MODE=true` for this workflow. The fixture follows a deterministic London/Paris route and the alert uses the pinned country boundary dataset; all resulting records remain explicitly labeled synthetic.

## Integration status and limits

BE-24 composition initializes Mongo indexes, installs default decoder settings, mounts the composed routes below the OpenAPI `/api/v1` base, and shuts down the HTTP server and Mongo connection cleanly. Real data sources remain disabled; this is not evidence of live provider access.

The local smoke exercises watch → position → message → decode/correlation → country crossing → persisted alert → reconnect refresh. A separate local run restarted the API while Mongo stayed up, then confirmed the France crossing events, current position, matched messages and decoder results were still readable. Real-provider access remains explicitly unverified. The BE-09 OpenAPI contract also lacks alert acknowledgement and the watchlist event type.
