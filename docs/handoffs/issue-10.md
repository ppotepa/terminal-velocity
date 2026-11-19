# Issue #10 — normalization handoff

## Status / execution log
- Status: BLOCKED for external acceptance and coordinator verification; local engineering prepared.
- Owner: implementation agent assigned by coordinator.
- Branch: feature/epic4-issue-10; baseline 4761d31 (merge PR #60 for #9).
- Dependency: #9 engineering merged and verified at 4761d31; external source acceptance remains open.
- Last update: 2026-11-19 19:09 UTC.
- History: 18:57 UTC — local IN PROGRESS recorded before implementation;
  19:09 UTC — engineering handoff, external acceptance remains BLOCKED.
- Planned paths: source-connectors normalization contracts/adapters, rendered-page reader,
  synthetic fixtures, backend/browser tests, source documentation.
- Constraints: repository-only edits; no GitHub writes, commits, network acquisition,
  credentials, deployment or persistent services. Existing demo API stays unchanged.
- External acceptance blocker: ADR 0001 has no permitted real sample. Owner must
  provide rights evidence and a permitted versioned sample before live validation.
- PR/merge/remote checks: coordinator-owned; not performed by this agent.

The coordinator records GitHub progress and authorizes sequential engineering while
external acceptance remains open. This handoff records the local implementation evidence.

## Engineering handoff

- Local implementation is prepared. Final issue acceptance remains **BLOCKED** on
  the external sample/rights gate and coordinator verification below; no DONE or
  merged-PR claim is made.
- Implemented strict versioned decoding, distinct time evidence and uncertainty,
  independent protocol/bearer classification, normalized aircraft hints and roles,
  immutable source provenance, explicit message/reception/frame validation, and
  a transient rendered-card adapter. Invalid records return safe typed failures.
- The browser reader preserves optional displayed evidence, distinguishes empty
  results from incompatible layouts, and rejects ambiguous/conflicting records.
- Added synthetic golden JSON fixtures, 13 normalization regressions and an
  offline browser-to-normalizer scenario. `test:messages` now includes normalization;
  `check` and `test:browser` also exercise the new tests through existing entry points.
- Documented the full revision/provenance handoff for #11 in `docs/SOURCES.md`.
  No #11 persistence implementation was started.

### Acceptance review

- [x] Canonical result includes correct provenance and declared data level —
  verified with synthetic message, reception and frame inputs.
- [x] Unknown/invalid provider variants fail explicitly without dropped silent
  records — strict synthetic versioned schema and negative regressions. Browser
  layout behavior has an executable regression awaiting sandbox-capable CI.
- [x] All fixtures are anonymized and permitted for repository use — all are
  repository-authored synthetic data with no real-source material; fixture README
  explicitly records this distinction. No real-source permission is asserted.
- [ ] Merged PR linked; passing checks, actual commands/results and limitations
  recorded — local evidence below; PR, merge and CI remain coordinator-owned.
- [ ] Permitted real-shape golden sample and live provider verification — owner
  must supply ADR 0001 rights evidence and an authorized sample. The optional
  semantic markup is fabricated and must be checked against that sample.

### Local commands and results

Node **24.22.3** was extracted from the already cached npm binary tarball into the
ignored worktree `tmp/node24` directory. No network fetch occurred. Commands used
`PATH="$PWD/tmp/node24/bin:$PATH"`; no runtime or toolchain files are part of the patch.
The shell's original default Node was 20.19.2, which cannot execute these TS tests;
that initial test attempt was replaced by the Node 24 runs below.

| Command | Actual result |
|---|---|
| `npm ci --offline --ignore-scripts --no-audit --no-fund` | PASS, 21 locked packages installed under Node 24; npm emitted sandbox `fchown` warnings, exit 0 |
| `npm run typecheck` | PASS, both workspaces |
| `npm run check:boundaries` | PASS, 193 source files / 663 AST dependencies |
| `node packages/backend/tests/source-normalization.test.mjs` | PASS, 13/13 tests, zero skipped |
| `node --test --test-isolation=none packages/backend/tests/*.test.mjs scripts/architecture/*.test.mjs scripts/messages/page-budget.test.mjs` | PASS, 145/145 tests, zero skipped |
| `npm run test:messages` | PASS, all 3 test files (transport, budget, normalization); this environment's isolated runner reports file totals |
| `npm run check` | NOT GREEN: typecheck, boundaries, architecture and all 10 backend test files pass; API suite has listener-dependent failures. Both full runs: 2/6 API files pass, 4 fail. Direct health diagnostic confirms `listen EPERM 127.0.0.1` |
| `npm run demo` | PASS, synthetic correlation/outbox/freshness/correction example |
| `npm run smoke` | FAIL before API listening: `listen EPERM 127.0.0.1` |
| `npm run test:postgres:local` | BLOCKED before tests: launcher requires an unprivileged user; current sandbox runs as root |
| `npm run test:browser` | FAIL, 0/2 browser test files. Direct rendered-page file: 1/5 tests passes (API unavailable), 4 cannot launch Chromium; sandbox startup reports `shutdown: Operation not permitted`. No browser E2E pass is claimed |
| `git diff --check` | PASS |

The unisolated command above provides individual test counts that the default
isolated runner does not expose here; it does not substitute for failed API,
browser or PostgreSQL checks. No assertions or sandbox protections were weakened.
These are local results, not coordinator CI or hosted CI evidence.

### Coordinator actions and remaining uncertainty

Run the normal exact-SHA CI sequence under the configured unprivileged worker,
including browser E2E, smoke and PostgreSQL tests. Inspect and resolve any actual
failures before review/merge; the restricted agent environment cannot establish
those results. The patch changes no SQL, transactions, migrations, grants or
startup wiring. No migration is required; rollback removes these normalization
modules and page-reader additions. The existing metadata store intentionally does
not persist the complete normalized revision wrapper.

For review, use a focused PR referencing #10 and explaining the synthetic scope,
explicit decoder failures and blocked real sample. The coordinator owns all
GitHub status transitions, branch integration, CI evidence, PR/merge links and
EPIC updates. This agent made no GitHub writes, commits, pushes or external
messages and did not advance the queue.
