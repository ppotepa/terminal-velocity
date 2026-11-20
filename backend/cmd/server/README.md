# Local server

The process exposes Mongo readiness at `GET http://127.0.0.1:8080/api/health` and composed API routes below `http://127.0.0.1:8080/api/v1`. Composition includes persisted WatchRule CRUD, aircraft/flight reads, message list/detail, Mongo-backed built-in decoder settings/preview, and bounded SSE. With synthetic mode enabled, active selected WatchRules drive labeled position and message fixtures, correlation, selected decoder runs, and SSE events. Alert evaluation is not yet composed; see the repository root [local MVP guide](../../../docs/LOCAL_MVP.md).

From the repository root, start MongoDB:

```sh
docker compose up -d mongo
docker compose ps
```

Then from `backend/` start the server:

```sh
/root/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.26.11.linux-amd64/bin/go run ./cmd/server
```

Set `TV_SYNTHETIC_MODE=true` before starting the process to enable deterministic, local callsign fixtures; only explicitly active WatchRules with position or message collection enabled are polled. The default bind address is loopback only. MongoDB data is persisted in ignored `data/mongo/`. Stop the process with Ctrl-C and MongoDB with `docker compose down`.

`TV_HTTP_ADDR`, `TV_MONGODB_URI`, and `TV_MONGODB_DATABASE` override the loopback address, Mongo URI, and database name. Mongo URIs and driver errors are not written to logs.
