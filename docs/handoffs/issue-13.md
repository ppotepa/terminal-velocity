# Issue #13 — source validation handoff

Status: **engineering review pending; external acceptance BLOCKED**. Owner:
Terminal Velocity coordinator. Branch: `feature/epic4-issue-13`. Dependency: #12
merged in PR #63 at `b04da88`. Work began November 19, 2026 UTC in the canonical
checkout. No GitHub issue transition was written because the coordinator owns
GitHub writes. The current issue body still needs its status log and label
updated by the coordinator.

Plan and touched paths: add a narrow PostgreSQL synthetic evidence regression
under `packages/backend/tests/integration`, document the authorized source
validation procedure and evidence in `docs/SOURCE_INTEGRATION_RUNBOOK.md`, and
correct Stage 3 implementation status in `docs/IMPLEMENTATION_STATUS.md` and
`docs/ROADMAP.md`. No database schema or application runtime changed. The actual
Airframes crawl command, its rendered reader, and inactive API strategy remain
unchanged. No real content was inspected or retained.

## Implemented engineering evidence

The new integration case uses the permission-checked provider pipeline and real
PostgreSQL tables to assert source delivery, provider observation ID, observation
and ingestion times, logical message revision, aircraft decision revision,
private contribution revision and private read across a worker composition
restart. It replays the same delivery and checks one effect. A second case
checks invalid decode, missing observation time, an unresolved aircraft and a
disconnected connector without false private freshness. Existing provider
pipeline tests also cover rendered acceptance, permission refusal, correction,
lost commit response and projection rollback. The added case is automatically
discovered by the existing `test:postgres:local` and `test:integration` runners.

## Local results

All commands below used Node 24.22.3 via
`PATH="$PWD/tmp/node24/package/bin:$PATH"` in this checkout. These are local
working-tree results, not exact-SHA CI or hosted checks.

| Command | Result |
|---|---|
| `npm ci --offline --no-audit --no-fund --cache "$PWD/tmp/npm-cache"` | PASS, 21 packages; sandbox emitted `fchown EINVAL` warnings |
| `npm run check` | FAIL overall: type checks and boundaries PASS (216 source files, 774 dependencies); architecture 1/1 file and backend 15/15 files PASS; API 2/6 files PASS, 4 fail in this sandbox |
| `npm run test:postgres:local` | BLOCKED before tests: `initdb` requires an unprivileged user; no SQL pass claimed |
| `npm run test:messages` | PASS, 3/3 test files |
| `npm run test:browser` | FAIL, 0/2 files; direct `on-demand.test.mjs` run shows `listen EPERM` on `127.0.0.1` |
| `node --check packages/backend/tests/integration/source-validation.test.mjs` | PASS syntax only |
| `git diff --check` | PASS |

The coordinator must execute the final revision in its existing private,
unprivileged CI, including PostgreSQL and browser suites. The new PostgreSQL
case has not run here. No hosted CI or merged PR is claimed. Coordinator
isolated CI for `23684099e27934139de2cec1c5e21a5e41406521` passed install
and check, then failed PostgreSQL with 86/87 tests passing. The failing
negative-case fixture changed only the ICAO24 while retaining the fleet's known
registration, making it a conflicting-identifiers case rather than an unknown
aircraft case. The working-tree correction supplies only the unknown ICAO24;
PostgreSQL CI must rerun on the corrected revision before it is claimed passing.

## Acceptance and unblock condition

- [ ] One actual licensed message with verifiable lineage: blocked on documented
  current crawl and retention rights plus an authorized private sample.
- [ ] Private processing and synthetic demo HTTP isolation: covered by existing
  integration tests, but this revision still needs the coordinator's PostgreSQL
  CI run. The new runbook does not grant publication rights.
- [ ] Source health and private availability: separate in the synthetic code
  path, with the new PostgreSQL assertion pending CI. Actual source health has
  not been measured.
- [ ] Real provider smoke, actual lag and latency, PostgreSQL CI, merged PR and
  passing checks: pending coordinator and owner action.

For external acceptance, the owner must provide a specific rights decision and
approved account/page/window, then authorize an isolated private smoke and a
restricted read surface. Follow the runbook and attach redacted evidence. Keep
Stage 3 externally blocked and do not advance Stage 4 as a validated real feed
until those conditions and merge verification are complete. No provider capacity,
coverage or station reception is asserted.
