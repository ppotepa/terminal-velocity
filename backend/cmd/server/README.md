# Local server

The process exposes Mongo readiness at `GET http://127.0.0.1:8080/api/health` and composed API routes below `http://127.0.0.1:8080/api/v1`. Current composition includes persisted WatchRule CRUD, inactive source health, Mongo-backed built-in decoder settings/preview, and the bounded SSE transport. The larger aircraft, flight, message, and alert integration flow is not yet composed; see the repository root [local MVP guide](../../../docs/LOCAL_MVP.md).

From the repository root, start MongoDB:

```sh
docker compose up -d mongo
docker compose ps
```

Then from `backend/` start the server:

```sh
/root/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.26.11.linux-amd64/bin/go run ./cmd/server
```

The default bind address is loopback only. MongoDB data is persisted in ignored `data/mongo/`. Stop the process with Ctrl-C and MongoDB with `docker compose down`.

`TV_HTTP_ADDR`, `TV_MONGODB_URI`, and `TV_MONGODB_DATABASE` override the loopback address, Mongo URI, and database name. Mongo URIs and driver errors are not written to logs.
