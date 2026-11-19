# Terminal Velocity — implementation guidelines

## Purpose and scope

Track aircraft positions and associated radio messages. The current stage is a local demonstration backend with memory and PostgreSQL storage modes. All fixtures are synthetic; connecting real sources requires a separate adapter and an explicit publication policy.

## Project language

Use English for all project-authored documentation, code comments, test names, examples, command output, user-facing text, commit messages, and pull request titles and descriptions. Preserve protocol identifiers and externally sourced message payloads in their original form.

## Responsibility boundaries

- Apply SRP: one reason to change per module, small use cases, and pure rules. File count is not a goal in itself.
- `packages/backend/src/modules/*/domain` must not depend on HTTP, Node, a database, or a composition root.
- Connect domains through their `public/index.ts` entries; do not import another module's private layers.
- `apps/api` depends only on the backend's public interface. The transport does not decide correlation or freshness.
- `src/demo` composes existing domains, fixtures, and storage adapters. PostgreSQL mode provides the documented durable flow; memory mode does not survive restart. Neither mode provides a real feed or a production access policy.
- Keep message facts, their decision, and the producer outbox in one SQL transaction. Keep consumer inbox, projection effects, and delivery acknowledgment in one separate SQL transaction. Never issue transaction statements through unrelated pool connections.
- Stage 2 contribution revisions derive from decision revisions only in its fixed synthetic scope. Real visibility changes require their own authoritative contribution/publication revision.
- Introduce generic mechanisms for a real shared contract; do not create BaseService, GenericRepository, or a service locator.
- Always distinguish observation time from ingestion time. Reimporting backfill does not make it fresh.
- Incomplete candidate sets, conflicting identifiers, and unresolved matches must not produce a confirmed status.
- Data visibility must also cover counts and statuses. Do not derive a public indicator from a private message.
- Preserve idempotency, tombstones, and reversible contributions. Revisions from different aggregates are not interchangeable.

## Issue execution and status management

Follow [the sequential issue execution workflow](docs/ISSUE_WORKFLOW.md) and the current [roadmap EPIC #4](https://github.com/ppotepa/terminal-velocity/issues/4). Its ordered child checklist is the canonical next-task sequence. **Only one child implementation issue may be active at a time**; do not start later issues before the immediate predecessor is completed and merged.

Before coding, update the selected issue body to `IN PROGRESS` and record its branch, owner/date, dependencies, intended steps, and blocker state. During development, tick verified acceptance criteria and record actual test/PR evidence in that same issue body. Mark `IN REVIEW` with the PR, then `DONE` only after merge and verification. Close it, check it off in the EPIC, update its counts/status history, and set the next issue `READY`. Keep blocked prerequisites explicitly `BLOCKED` with an unblock condition; never silently skip them. Do not report local tests as passing remote CI.

## Verification

Run `npm ci` and `npm run check` from the repository root. A material change to the startup flow also requires checking API process startup and shutdown. Add behavioral and regression tests for changed invariants, rather than tests that repeat the implementation.

Changes to PostgreSQL transactions, migrations, leases, projections, or durable application wiring also require `npm run test:integration` against an isolated PostgreSQL instance, or `npm run test:postgres:local` with installed binaries. Integration tests must not silently skip when their database is unavailable. The API never applies migrations or uses migration credentials.

New dependencies must serve a concrete purpose. Keep the lockfile. Do not add secrets, real receiver data, or production messages to fixtures.

## Changes and documentation

Work on a feature branch. A PR description must cover the problem, behavior change, verification, and actual limitations. Update `docs/IMPLEMENTATION_STATUS.md` when the implemented scope changes. Documents in `docs/architecture/` describe the target architecture; they do not establish that every component has been implemented.
