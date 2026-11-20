# Local backend MVP

## Start

From the repository root:

```sh
docker compose up -d mongo
docker compose ps
cd backend
/root/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.26.11.linux-amd64/bin/go run ./cmd/server
```

The API binds to `127.0.0.1:8080`. MongoDB is published only on `127.0.0.1:27017`; its data remains in the ignored `data/mongo/` directory. Stop the server with Ctrl-C and MongoDB with `docker compose down`.

## Verified local routes

- `GET /api/health` reports Mongo readiness.
- `/api/v1/watch-rules` supports persisted WatchRule CRUD.
- `GET /api/v1/sources` reports OpenSky, the Airframes crawler, and Airframes API as inactive. No provider is contacted.
- `/api/v1/decoders` lists built-in decoder descriptors and Mongo-backed settings; config updates use `If-Match` revisions.
- `POST /api/v1/decoders/{decoderId}/preview` decodes a supplied bounded payload without persisting it.
- `/api/v1/map/snapshot`, aircraft/flight list routes, and `/api/v1/flights/{id}/track` are mounted. With all providers inactive, map/list responses are empty; track reads persisted observed points only.
- `GET /api/v1/events` serves SSE heartbeats and `snapshot_required` for stale cursors. Event producers are not yet connected in composition.

Run the reproducible smoke checks from the repository root while Mongo and the API are running:

```sh
./scripts/demo/smoke.sh
```

The script creates and removes a temporary paused watch rule, requests a synthetic decoder preview, checks inactive source status, and verifies stale-cursor snapshot recovery.

## Integration status and limits

BE-24 composition initializes Mongo indexes, installs default decoder settings, mounts the composed routes below the OpenAPI `/api/v1` base, and shuts down the HTTP server and Mongo connection cleanly. Real data sources remain disabled; this is not evidence of live provider access.

The full watch → position → message → decode/correlation → alert → reconnect workflow is not yet available from the running process. Position/message/flight/alert read handlers still need application adapters and producers; alert rule deletion and persisted rule parameters are not exposed by the current application layer. The in-process SSE hub is implemented and tested, but BE-24 must connect producer events and reconcile the alert acknowledgement operation absent from the BE-09 OpenAPI contract. Do not treat the partial route smoke as full integrated acceptance.
