# Local server

The initial Go process exposes `GET http://127.0.0.1:8080/api/health` and
requires a reachable MongoDB instance. Its default HTTP bind is loopback only.
MongoDB connection strings may contain credentials; the process never logs the
URI or underlying connection error.

From the repository root, start the local MongoDB service:

```sh
docker compose up -d mongo
docker compose ps
```

Then start the server in another terminal:

```sh
cd backend
TV_HTTP_ADDR=127.0.0.1:8080 \
TV_MONGODB_URI=mongodb://127.0.0.1:27017 \
TV_MONGODB_DATABASE=terminal_velocity \
/usr/lib/go-1.25/bin/go run ./cmd/server
```

Or copy `.env.example` to `.env` and export its values before running the
server:

```sh
cp .env.example .env
set -a
. ./.env
set +a
cd backend
/usr/lib/go-1.25/bin/go run ./cmd/server
```

The Go process reads environment variables directly; Compose uses the Mongo
port and data path from `compose.yaml`. Mongo data is persisted at
`data/mongo/`, which is ignored by Git. Stop the server with Ctrl-C, then stop
MongoDB with `docker compose down`. The data directory remains for the next
start.

Configuration variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TV_HTTP_ADDR` | `127.0.0.1:8080` | Loopback HTTP listen address |
| `TV_MONGODB_URI` | `mongodb://127.0.0.1:27017` | MongoDB URI (never logged) |
| `TV_MONGODB_DATABASE` | `terminal_velocity` | Database name |

Health returns HTTP 200 with `status: ok` when MongoDB responds to ping, and
HTTP 503 with `status: degraded` when it is unavailable.
