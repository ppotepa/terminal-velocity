# Local UI

Start MongoDB and the local API as described in [LOCAL_MVP.md](./LOCAL_MVP.md), then run the frontend from the repository root:

```sh
cd frontend
npm ci
npm run dev
```

Vite listens on `127.0.0.1:5173` and proxies `/api` requests to the loopback API at `127.0.0.1:8080`. The app navigation includes Map, Watch Rules, History, Messages, Decoders, Alerts, and Source Settings. Selecting an aircraft shares that selection with details and history; message results can navigate to the associated aircraft or flight.

The map uses MapLibre and the OpenFreeMap Liberty style by default. Set `VITE_MAP_STYLE_URL` to a compatible style URL to use a different map style. Map tiles require network access. If the style fails, the map falls back to a neutral background. Only positions returned by the backend's active Watch Rules are displayed.

The local UI uses the synthetic backend source only when `TV_SYNTHETIC_MODE=true` is set for the API. Synthetic data is explicitly labeled. OpenSky, the Airframes crawler, and the Airframes API remain blocked or unconfigured by default; no live-provider access is implied. Source controls are read-only because the current API exposes no pause/resume operation.

The production frontend build and TypeScript check are verified with:

```sh
npm run build
```

This host has no installed browser, so manual visual interaction has not been recorded as verified. The API's deterministic end-to-end workflow, persistence across restart, and SSE snapshot recovery are covered by the local smoke procedure in [LOCAL_MVP.md](./LOCAL_MVP.md).

## Flight workspace

The map uses the same flight card in Debug and Live. Both read the workspace
API through the Go server. The local collector uses Python 3 with SQLite and
runs independently of browser sessions. Set `TV_WORKSPACE_SOCKET` in the API
and collector to the same Unix socket. Set `TV_SNAPSHOT_PATH` in the collector
to the atomic JSON output of the existing regional timer. The packaged unit is
`scripts/live/terminal-velocity-workspace.service`. From the repository, start
the collector with `python3 scripts/live/workspace/server.py`. Its database
defaults to `data/flight-workspace.sqlite3` relative to its working directory.
`TV_FLIGHT_DB` overrides the path. Preserve the database when updating the site.

Under `/api/v1/workspace/{debug|live}`, GET `snapshot` returns current markers.
GET `flights/{id}` returns details and renews a 20-second preview lease.
GET `flights/{id}/events` accepts `before` (the previous page's opaque next
cursor) and `source` (ADS-B or Airframes). POST `flights/{id}/rules` takes
`kind`, `sources`, `active`, and a corridor ID in `target` for corridor rules.
Posting the same configuration is idempotent. POST `legacy` in Live imports an
explicitly selected local aircraft ID. Saved configurations and their event
associations live in SQLite.

Live flight identity is inferred from the ICAO address, observed callsign
changes and a 45-minute contact gap. The map breaks the trace after 12 minutes
without a position. Airframes queries use the documented ICAO filter, a time
window and a shared worker for previews and active listeners. An optional
`TV_AIRFRAMES_API_KEY` supplies a bearer token. Only confirmed frames count
toward the green ring. The collector keeps the message fields and receiver
identifier. It omits station-account metadata. Connection names come from
observed airport metadata. For known connections, observed segments of at
least 35 km can define a 16 km wide corridor. Passage requires observations
spanning 60% of its length in one continuous segment.

Debug starts with two flight dates for TV201, a second aircraft, a two-station
frame and an observed corridor. Its clock advances locally. The second aircraft
periodically drops out of coverage. Debug listeners and frames stay in the
Debug namespace.
