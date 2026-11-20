# Sequential GitHub issue execution workflow

**Canonical EPIC:** [#4 — Complete Terminal Velocity Roadmap](https://github.com/ppotepa/terminal-velocity/issues/4)
**Scope:** 48 ordered implementation issues, [#5–#52](https://github.com/ppotepa/terminal-velocity/issues) (Stages 3–6 and release readiness). The epic issue body is the **current progress dashboard and canonical execution order**. The child issue body is the **authoritative requirement and progress record** for that single deliverable.

All project-authored issue descriptions, updates, tests, comments, commits, PRs, and documentation use **English**.

## Temporary code-first delivery mode (2026-11-20)

[The Master Code Implementation Plan](MASTER_IMPLEMENTATION_PLAN.md) is the consolidated agent implementation workbook. The owner wants locally functioning code and an observable synthetic/private MVP **before any CI/CD or deployment work**. Hosted GitHub Actions status, runner billing, CI branch rules and deployment pipelines are deferred to release issues #49–#52; do not treat missing hosted CI as proof that code failed, nor claim it passed. Run and record local unit, type, boundary, PostgreSQL and browser/API tests when relevant.

**Sequential work still applies to code issues.** When a predecessor has verified engineering work but is `BLOCKED` on source permission, real data access or external owner approval, keep that issue open; EPIC #4 explicitly permits moving to the next technically independent *local synthetic* work package. Record the exception and dependency in both issue bodies/EPIC before advancing. Never bypass a real code dependency or use unlicensed real messages/positions in an internal or public database. Only one code implementation issue should be `IN PROGRESS` or `IN REVIEW` at a time.

## One issue, one complete outcome

- Treat a child issue as one independently demonstrable deliverable. It owns its objective, exact steps, intended modules/files, interface constraints, validation, acceptance criteria and explicit non-goals.
- Finish and verify the preceding issue before activating the next number in the epic. Only **one implementation issue** may be `IN PROGRESS` or `IN REVIEW` at any time.
- Prefer one issue per focused PR. Do not implement later issues opportunistically, even if they seem related. If a prerequisite is wrong, update both issue bodies and the epic ordering **before** changing scope.
- No empty folder structures or TODO-only stubs count as implementation. An issue must contain an end-to-end verified behavior, including the declared failure modes.
- Separate domain rules, orchestration, ports, and infrastructure consistently with SRP. A file or class only exists when it has a meaningful responsibility; file count is not a goal.

## Status vocabulary

| Status | Meaning | Required update |
|---|---|---|
| `BACKLOG` | Described, but a predecessor is incomplete | Keep issue open; record dependency |
| `READY` | All dependencies satisfied and work may start | Update the issue body and epic's next issue |
| `IN PROGRESS` | Work is actively being implemented | Record branch, owner, timestamp and current substeps |
| `IN REVIEW` | PR opened, required evidence being reviewed | Link PR, commands/results, unresolved review comments |
| `BLOCKED` | Cannot progress without specific action | Describe exact blocker, responsible party and unblock condition; do not silently skip |
| `DONE` | Work accepted, merged and verified | Check all acceptance boxes, link merged PR and actual evidence; close issue with completed reason |

GitHub's native `open/closed` state is separate from these workflow states. Do **not** mark an issue `DONE` merely because a PR was opened or tests were planned. Avoid `Closes #N` automation before the issue is ready to close; use `Refs #N` if verification will happen after merge.

## Before starting an issue

1. Read the current [EPIC #4](https://github.com/ppotepa/terminal-velocity/issues/4), `AGENTS.md`, the relevant child issue and any files mentioned there.
2. Verify that the **immediate predecessor** is `DONE`, closed, and linked to a merged PR with proof of verification. If not, keep the new issue `BACKLOG` or mark it `BLOCKED`.
3. Validate external prerequisites first: licensed data access, provider rights, account credentials, relevant integration environments and existing migrations. If unavailable, state the blocker in the issue; do not fabricate access, fixtures, RF frames or a passing test.
4. Edit the child issue body to `IN PROGRESS` with branch name, date, owner and an implementation plan. Add a short timestamped comment recording the transition. Keep the original requirements and acceptance boxes intact.
5. Implement only the issue's described work on its own feature branch.

## During implementation

- Keep the **same issue body** current. Check completed acceptance/verification boxes **only after actually testing**; do not delete uncompleted boxes or change requirements silently.
- Record meaningful design decisions, file/contract changes, migration notes, measured facts, risks and PR links in the issue's `Status / execution log`.
- Log blockers, regressions or scope disagreements in a timestamped comment. If work cannot continue, update the body to `BLOCKED` with one clear unblock condition; inform the epic and do not advance.
- Preserve the provider data-level distinction (`PROVIDER_MESSAGE` vs actual reception/frame), time semantics, restricted publication and independently versioned grants/decisions.
- Use `npm run check` for type checks, architecture rules and unit tests. For database work, also run `npm run test:integration` or `npm run test:postgres:local` against real PostgreSQL. For frontend and WS changes, include browser/E2E verification and replay/security tests.

## Review and completion

1. Open a PR referencing the issue. Edit the issue body to `IN REVIEW` with PR link, actual verification commands/results, reviewer issues and current limitations.
2. Check all acceptance conditions. Update implementation status/roadmap and relevant docs if their truth changed. Re-run the affected checks after review fixes.
3. Merge the PR when accepted, then update the child issue's evidence (merged commit SHA, test outcomes, remaining limitations and rollback/migration notes). Change status to `DONE`, add a completion comment and close as `completed`.
4. In the same work session update [EPIC #4](https://github.com/ppotepa/terminal-velocity/issues/4): check exactly that issue, increment stage and total counters, update the last entry of the progress log, and set only the next uncompleted issue to `READY`.
5. Confirm the next issue body's immediate dependency and that no other implementation issue is `IN PROGRESS`.

**Important CI distinction:** GitHub Actions has historically been blocked before the first job step by the account's billing configuration. Local test success does **not** imply GitHub CI success. Keep the remote check status and its URL accurate in each issue and PR. If required checks cannot run, mark the release gate as `BLOCKED` and record the owner-approved internal exception (if any); never claim a green CI result.

## Copyable issue progress record

Use this structure inside the existing child issue body, below its specification:

```md
## Status / execution log
- **Status:** IN PROGRESS
- **Owner:** <GitHub username or Unassigned>
- **Branch:** feat/s3-01-source-observation-contracts
- **PR:** Not opened
- **Dependency:** #<previous> DONE, linked to merged PR
- **Last updated:** YYYY-MM-DD HH:MM UTC
- **Blocker:** None / specific blocker and unblock condition
- **Implementation evidence:** commit links and decisions
- **Test evidence:** commands, actual results, CI run URL, limitations

### History
- YYYY-MM-DD HH:MM UTC — READY → IN PROGRESS: reason and branch
- YYYY-MM-DD HH:MM UTC — IN PROGRESS → IN REVIEW: PR and tests
- YYYY-MM-DD HH:MM UTC — IN REVIEW → DONE: merged SHA, final checks and epic progress
```

The epic uses GitHub task-list checkboxes referencing its child issues. These linked checkboxes and the issue bodies are the maintained status system; no background automation is implied. If additional GitHub Projects fields or labels are introduced later, they must remain consistent with the canonical issue bodies.
