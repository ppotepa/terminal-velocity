# Private web shell

The React/Vite workspace is a local light-mode shell for the synthetic tracker.
It provides responsive navigation, accessible controls, URL selection and filter
state, and a typed client for the private map snapshot. The map surface is an
explicit placeholder; MapLibre markers and tracks belong to issue #22, while
aircraft details and message panels belong to #23. Flights and Stations are
visible navigation placeholders, not claims of implemented data.

## Run locally

Use Node 24 and install the checked-in lockfile with `npm ci`. In one terminal,
run `npm start` for the loopback API on port 3000. In another, run
`npm run dev --workspace=@airframes/web`. Open `http://127.0.0.1:5173`.
Vite binds to loopback and proxies `/api` to `127.0.0.1:3000`. The production
build is static and needs an authorized same-origin API setup before any future
deployment; no public hosting is configured here.

The shell queries one fixed local bbox (`14,48,24,56`) and shows the page count,
loading, empty, and error states. It does not render aircraft markers or infer
live feed health. Filters and selection are encoded in the URL; the client
validates the map response and keeps no payload in local storage. The API is
synthetic/private and has no public authorization policy. Keep both processes
on loopback.

## Checks

`npm run check` includes strict web types, web ESLint, architecture rules,
unit tests and the Vite build. `npm run test:browser` additionally runs the
Playwright shell checks after the build, including 1440, 1024, 768 and 390 px
layout/typography snapshots, keyboard focus, named controls, URL navigation,
and synthetic loading/empty/error behavior. The browser checks use intercepted
synthetic API responses and need a local Chromium headless shell. The isolated
local CI runner also exercises the existing PostgreSQL and API regression gates.
