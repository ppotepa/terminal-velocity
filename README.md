# Terminal Velocity

A backend for an application that connects an aircraft map with aircraft radio messages. The project uses a modular monolith: small domain modules, SRP, explicit ports, and controlled dependencies.

Repository: [ppotepa/terminal-velocity](https://github.com/ppotepa/terminal-velocity). Earlier design documents use the working name Airframes Tracker; internal packages retain the `@airframes` namespace. All project-authored documentation and text use English.

**Stage 1: local API demonstrator.** It accepts synthetic messages, correlates them with aircraft, determines message availability, and exposes data for the future map. Positions are fixtures. Data lives in one process's memory and is lost on restart.

## Quick start

Requires Node.js 24.x and npm. From the repository root:

```bash
npm ci
npm run check
npm start
```

The API listens on `http://127.0.0.1:3000`. Set `PORT` to use a different port. The host is fixed because the demonstrator does not yet provide production authentication or a publication policy.

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

An HTTP request passes through body limits and JSON parsing, message fact validation, the correlation rule, and the availability contribution update. Demo state is committed in one process through a queue that serializes operations. Repeating the same `messageId` with the same facts returns the earlier result. Different facts under the same ID produce a conflict.

Freshness uses **observation time**, including for historical data. Expired statuses are recalculated on reads. Message freshness (`RECENT`, `STALE`, or `NONE`), coverage, and feed health are separate dimensions; a synthetic message does not indicate a connection to a real receiver. See [API.md](docs/API.md) for the contract.

## Structure

| Path | Responsibility |
|---|---|
| `packages/backend/src/kernel` | Small shared types, Result, and time |
| `packages/backend/src/contracts` | Typed identifiers |
| `packages/backend/src/modules/aircraft-correlation` | Aircraft identity based on temporal evidence |
| `packages/backend/src/modules/message-availability` | Reversible contributions, freshness, and expiry |
| `packages/backend/src/demo` | Scenario composition, synthetic catalog, in-memory state, and DTOs |
| `apps/api/src` | HTTP transport, routing, process configuration, and shutdown |
| `scripts/architecture` | Dependency checks using the TypeScript AST and violation tests |
| `docs/architecture` | Agreed architecture v2, responsibility catalog, and proposed contracts |

Granularity follows code responsibilities. Each file does not require a separate process or npm package.

## Commands

| Command | Scope |
|---|---|
| `npm run check` | Strict type checking, module boundaries, and all tests |
| `npm run typecheck` | TypeScript verification with `tsc` |
| `npm run check:boundaries` | Static dependency and cycle checks |
| `npm test` | Domain, API scenario, and architecture checker tests |
| `npm run demo` | Reference example of correlation, outbox, and an A→B correction |
| `npm start` | Demonstration server on localhost |
| `npm run example` | Example client for a running server |
| `npm run smoke` | Actual entrypoint startup, example client, and process shutdown |

The GitHub Actions workflow is configured to run the same checks. Node strips types when executing `.ts` sources; `tsc` checks types separately. The application requires no external runtime packages.

## Status and next steps

[IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) distinguishes implemented behavior from the target architecture. [ROADMAP.md](docs/ROADMAP.md) describes the next slices: PostgreSQL, one real connector, positions and map reads, publication scope, and incremental updates.

The current stage does not include real ADS-B/Airframes sources, a complete RF decoder, reassembly, PostgreSQL, a production outbox relay, or a frontend. SQL and JSON Schema files in the architecture documentation are designs for future implementation. Public deployment requires the access and publication layers first.
