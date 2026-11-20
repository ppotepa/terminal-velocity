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
