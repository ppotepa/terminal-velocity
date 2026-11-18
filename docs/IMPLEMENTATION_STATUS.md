# Terminal Velocity — implementation status, stage 1

Date: November 18, 2026. Code version: `0.1.0`. This stage provides a runnable backend and one coherent flow through the domain, ready for further development on GitHub.

## Implemented

| Area | Implementation |
|---|---|
| Repository | npm workspaces, Node.js 24.x, lockfile, instructions, and a GitHub Actions workflow |
| Correlation | Strong temporal identifiers, conflict veto, ambiguity, and candidate completeness checks |
| Availability | Reversible contributions, A→B correction in the core, tombstones, 10/60-minute thresholds, and revision-guarded expiry |
| Demo scenario | Three synthetic aircraft, validation, idempotent ingestion, and one committed state protected by a mutex |
| API | Six endpoints, input limits, explicit error statuses, DTOs, loopback, and graceful shutdown |
| Boundaries | AST analysis of imports and exports, public module entries, and cycle detection |
| Project support | README, API guide, roadmap, contribution guidelines, and an example client |

The workspaces contain **98 TypeScript source files**. Additional `.mjs` files implement the checker, tests, and scripts. The breakdown follows the responsibilities of parsers, rules, use cases, adapters, contracts, and composition roots.

## Local verification

| Check | Result |
|---|---|
| `tsc --noEmit` for both workspaces | PASS with strict settings |
| Architecture boundaries | PASS, 98 files / 321 AST dependencies |
| AST checker regressions | 28/28 PASS |
| Backend tests | 62/62 PASS — 41 core and 21 demo scenario tests |
| HTTP/configuration/shutdown tests | 25/25 PASS |
| Total tests | **115/115 PASS** |
| Core example | PASS: correlation, test outbox, expiry, and A→B correction |
| Actual entrypoint startup | PASS: health, client POST/replay, RECENT, and SIGTERM shutdown |

These results were obtained locally with Node.js 24.22.3. The initial [GitHub Actions run](https://github.com/ppotepa/terminal-velocity/actions/runs/44353808639) was blocked before the first job step. Local results do not establish a successful CI run; verify CI against the specific commit once GitHub can execute the job.

## Guarantee boundaries

The demo API stages changes and performs one `DemoState` swap under a mutex. This provides atomicity within one process, without durability or isolation across processes. Restarting clears state and idempotency history. The 500-message limit bounds the in-memory collection.

The earlier decision + outbox transaction port and its memory adapter still have tests in the core. **They are not a production outbox connected to the demo HTTP path.** The PostgreSQL adapter, relay, inbox, and delivery acknowledgments remain to be implemented.

Demo status is recalculated on reads; the process does not run a durable scheduler. Clients cannot set publication permissions. Internal `publicEligible: true` contributions apply only to the synthetic demonstration scope and do not constitute a complete access policy.

Positions are static fixtures; real flight tracking is not implemented. The API represents the absence of a real feed as `DISCONNECTED`. Demo messages are decoded text examples, not captured RF frames. The project does not yet include a map frontend, flight sessions, reassembly, or Airframes/ADS-B integrations.

Architecture v2 is retained in `docs/architecture`. Its catalog of 89 responsibilities describes the intended direction, not a count of completed services. See [ROADMAP.md](ROADMAP.md) for the next stage.
