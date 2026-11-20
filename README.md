# Terminal Velocity

Terminal Velocity is a locally run Go and MongoDB application for bounded, watch-rule-driven aircraft observations, message decoding, alerts, and a typed REST/SSE API.

## Local backend

Start MongoDB and the API from the repository root:

```sh
docker compose up -d mongo
cd backend
/root/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.26.11.linux-amd64/bin/go run ./cmd/server
```

The server listens on loopback at `http://127.0.0.1:8080`. Routes currently composed include health, watch-rule CRUD, source health, decoder settings/preview, and SSE under `/api/v1`; see [docs/LOCAL_MVP.md](docs/LOCAL_MVP.md) for the verified flow and current integration state.

Provider acquisition is disabled unless permitted source configuration is explicitly wired. Synthetic decoder previews are local inputs and are not persisted.
