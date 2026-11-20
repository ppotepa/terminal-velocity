# Terminal Velocity

A private local prototype that connects aircraft positions with associated radio-message status. The project uses small domain modules, explicit ports, controlled dependencies and a React web shell.

Repository: [ppotepa/terminal-velocity](https://github.com/ppotepa/terminal-velocity). Earlier design documents use the working name Airframes Tracker; internal packages retain the `@airframes` namespace. All project-authored documentation and text use English.

The API accepts synthetic messages and exposes separate position and message status. PostgreSQL mode persists message facts and private position projections; memory mode remains a quick three-aircraft demonstration. The web shell is local and synthetic. MapLibre markers, public authentication and publication policy are later stages.

## Quick start — memory mode

Requires Node.js 24.x and npm. From the repository root:

```bash
npm ci
npm run check
npm start
```

The API listens on `http://127.0.0.1:3000`. Set `PORT` to use a different port. The host is fixed because the demonstrator does not yet provide production authentication or a publication policy.

To open the private web shell, leave the API on port 3000 and run
`npm run dev --workspace=@airframes/web` in another terminal. Visit
`http://127.0.0.1:5173`. See [WEB.md](docs/WEB.md) for scope and checks.

For persistent storage, follow [PostgreSQL setup](docs/POSTGRES.md). It provides a local Compose database, explicit migrations, a separate runtime login, and startup with `STORAGE_DRIVER=postgres`. The API reads exported environment variables; it does not load an `.env` file automatically.

In a second terminal, run the example client. It selects a fixture aircraft, submits a message, and displays the result:

```bash
npm run example
```

You can also query the API directly:

```bash
curl http://127.0.0.1:3000/healthz
curl http://127.0.0.1:3000/api/v1/aircraft
```

## Implemented flow

An HTTP request passes through body limits, JSON parsing, fact validation, and the correlation rule. Repeating the same `messageId` with the same facts returns the stored message with `created: false`. Different facts under the same ID produce a conflict.

In PostgreSQL mode, one transaction commits immutable message facts, the versioned decision, and its outbox event. A durable queue delivers the event to the availability consumer; its inbox, contribution update, and acknowledgment commit together. Availability reads are eventually consistent with ingestion. Concurrent processes coordinate through database locks and fenced leases. In memory mode, one process-local state swap remains the commit point, and restart clears the data.

Freshness uses **observation time**, including for historical data. Expired statuses are recalculated on reads. Message freshness (`RECENT`, `STALE`, or `NONE`), coverage, and feed health are separate dimensions; a synthetic message does not indicate a connection to a real receiver. See [API.md](docs/API.md) for the contract.

## Structure

| Path | Responsibility |
|---|---|
| `packages/backend/src/kernel` | Small shared types, Result, and time |
| `packages/backend/src/contracts` | Typed identifiers and small SQL capability contracts |
| `packages/backend/src/modules/aircraft-correlation` | Aircraft identity based on temporal evidence |
| `packages/backend/src/modules/message-availability` | Reversible contributions, freshness, and expiry |
| `packages/backend/src/modules/database-transactions` | Connection ownership, transaction lifetime, commit and rollback |
| `packages/backend/src/modules/event-delivery` | Fan-out, fenced leases, retries, inbox deduplication, and acknowledgment |
| `packages/backend/src/demo` | Synthetic scenario composition, memory/PostgreSQL adapters, and DTOs |
| `apps/api/src` | HTTP transport, routing, process configuration, and shutdown |
| `apps/web/src` | Private React shell, reusable controls and typed API client |
| `db/migrations` | Executable, checksummed PostgreSQL migrations and schema ownership |
| `scripts/postgres` | Migration CLI and isolated real-database test harness |
| `scripts/architecture` | Dependency checks using the TypeScript AST and violation tests |
| `docs/architecture` | Agreed architecture v2, responsibility catalog, and proposed contracts |

Granularity follows code responsibilities. Each file does not require a separate process or npm package.

## Commands

| Command | Scope |
|---|---|
| `npm run check` | Strict types, module boundaries, web lint/build and database-independent tests |
| `npm run build:web` | Production asset build for the private web shell |
| `npm run test:browser` | Local Chromium browser checks, including the web shell |
| `npm run typecheck` | TypeScript verification with `tsc` |
| `npm run check:boundaries` | Static dependency and cycle checks |
| `npm test` | Domain, API scenario, and architecture checker tests |
| `npm run demo` | Reference example of correlation, outbox, and an A→B correction |
| `npm start` | Demonstration server on localhost |
| `npm run example` | Example client for a running server |
| `npm run smoke` | Actual entrypoint startup, example client, and process shutdown |
| `npm run db:migrate` | Apply checked-in migrations using `MIGRATION_DATABASE_URL` |
| `npm run db:local-runtime` | Provision the restricted login for the supplied local Compose setup |
| `npm run test:integration` | Real PostgreSQL integration tests using an isolated `TEST_DATABASE_URL` |
| `npm run test:postgres:local` | Start installed PostgreSQL binaries, run integration tests, and remove the temporary cluster |

The GitHub Actions workflow is configured to run the checks and real PostgreSQL integration suite. Node strips types when executing `.ts` sources; `tsc` checks types separately. PostgreSQL adapters use the pinned `pg` driver; domain and application rules do not import the driver.

## Status and next steps

[IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) distinguishes implemented behavior from the target architecture. [MASTER_IMPLEMENTATION_PLAN.md](docs/MASTER_IMPLEMENTATION_PLAN.md) is the complete issue-by-issue, code-first agent execution plan (48 tasks; hosted CI/CD postponed). [ROADMAP.md](docs/ROADMAP.md) describes the next slices: one real connector, positions and map reads, publication scope, and incremental updates.

The current stage does not include approved real ADS-B/Airframes retention, a complete RF decoder, reassembly, map markers, or production access/publication controls. Durable availability currently has one fixed synthetic visibility scope. The SQL and JSON Schema files under `docs/architecture` remain historical target designs; executable schema lives under `db/migrations`. Public deployment requires the access and publication layers first.
