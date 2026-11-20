# Terminal Velocity

Terminal Velocity is a locally run Go and MongoDB application for bounded, watch-rule-driven aircraft observations, message decoding, alerts, and a typed REST/SSE API.

## Local backend

Start MongoDB and the API from the repository root:

```sh
docker compose up -d mongo
cd backend
/root/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.26.11.linux-amd64/bin/go run ./cmd/server
```

The server listens on loopback at `http://127.0.0.1:8080`. Routes include health, watch and alert rule CRUD, aircraft/flight and message reads, decoder settings/preview, alert history, and SSE under `/api/v1`; see [docs/LOCAL_MVP.md](docs/LOCAL_MVP.md) for the verified synthetic workflow and integration status.

Provider acquisition is disabled unless permitted source configuration is explicitly wired. Synthetic decoder previews are local inputs and are not persisted.
