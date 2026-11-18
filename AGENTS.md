# Terminal Velocity — implementation guidelines

## Purpose and scope

Track aircraft positions and associated radio messages. The current stage is a local demonstration backend. All fixtures are synthetic; connecting real sources requires a separate adapter and an explicit publication policy.

## Project language

Use English for all project-authored documentation, code comments, test names, examples, command output, user-facing text, commit messages, and pull request titles and descriptions. Preserve protocol identifiers and externally sourced message payloads in their original form.

## Responsibility boundaries

- Apply SRP: one reason to change per module, small use cases, and pure rules. File count is not a goal in itself.
- `packages/backend/src/modules/*/domain` must not depend on HTTP, Node, a database, or a composition root.
- Connect domains through their `public/index.ts` entries; do not import another module's private layers.
- `apps/api` depends only on the backend's public interface. The transport does not decide correlation or freshness.
- `src/demo` composes existing domains, fixtures, and in-memory adapters. Describe its actual guarantees; it does not provide durable processing, a real feed, or a production access policy.
- Introduce generic mechanisms for a real shared contract; do not create BaseService, GenericRepository, or a service locator.
- Always distinguish observation time from ingestion time. Reimporting backfill does not make it fresh.
- Incomplete candidate sets, conflicting identifiers, and unresolved matches must not produce a confirmed status.
- Data visibility must also cover counts and statuses. Do not derive a public indicator from a private message.
- Preserve idempotency, tombstones, and reversible contributions. Revisions from different aggregates are not interchangeable.

## Verification

Run `npm ci` and `npm run check` from the repository root. A material change to the startup flow also requires checking API process startup and shutdown. Add behavioral and regression tests for changed invariants, rather than tests that repeat the implementation.

New dependencies must serve a concrete purpose. Keep the lockfile. Do not add secrets, real receiver data, or production messages to fixtures.

## Changes and documentation

Work on a feature branch. A PR description must cover the problem, behavior change, verification, and actual limitations. Update `docs/IMPLEMENTATION_STATUS.md` when the implemented scope changes. Documents in `docs/architecture/` describe the target architecture; they do not establish that every component has been implemented.
