# Transaction contracts for PostgreSQL adapters

This is an adapter behavior design, not a tested migration. `REFERENCE_DDL.sql` contains selected tables. The reference test double demonstrates only the documented behavior within the memory of a single process.

## 1. CommitCorrelationRevision

Input: messageId, expectedRevision, the complete new decision, messageRevision, candidateIndexRevision, policyVersion, eventId.

1. Begin a transaction.
2. Serialize competing changes for messageId. Option A: CAS `UPDATE ... WHERE revision = expected` and check the number of affected rows. Option B: lock a correctly created head row or acquire a transaction-scoped lock for the key. `SELECT FOR UPDATE` alone does not lock a nonexistent row during the initial insert.
3. If expectedRevision does not match the current revision, return a conflict without changing state or the outbox.
4. Persist an immutable decision revision, set the current head and append the outbox entry in the same transaction.
5. Commit. Report success only afterward.

The first write uses messageId uniqueness and handles a concurrent INSERT as a conflict/retry. A uniqueness violation must not be treated as a successful commit without checking what was actually committed. The SERIALIZABLE isolation option also requires retry handling.

## 2. ConsumeOnce

Use `(consumerId,eventId)` as the key, not eventId alone. A payload digest detects conflicting deliveries of the same ID.

1. BEGIN.
2. `INSERT consumer_inbox ... ON CONFLICT DO NOTHING RETURNING ...`.
3. If no row was inserted, compare the digest. A match means idempotent success; a mismatch means conflict/quarantine, with no new effect.
4. For a new record, apply the effect to the consumer's own tables and append any new outbox events.
5. COMMIT, then ACK or mark the delivery DONE.

A crash before commit rolls back both the inbox entry and the effect. A crash after commit but before ACK causes a repeated delivery recognized by the inbox. Catching an error must not leave partial effects in place.

## 3. Durable fan-out before introducing a broker

The dispatcher finds **all** outbox entries without `fanout_completed_at`, not just records with IDs greater than the last recorded maximum. ID allocation order is not commit order.

A short transaction claims a batch, reads a fixed version of the subscriber registry, creates deliveries with uniqueness on `(consumerId,eventId)` and marks fan-out complete. A new consumer has a separate, controlled backfill; an old fan-out marker is not expected to replay history automatically.

A delivery worker assigns leaseToken and leaseUntil, performs the work and commits the result only if the token still matches. A reaper returns expired leases to READY. An old worker instance cannot acknowledge work that another worker has already claimed.

Per-stream ordering: delta events wait for the expected revision; replacement events may supersede earlier revisions. Gaps are not unconditionally ignored. Backoff and quarantine have separate contracts; retries must not become an unbounded loop.

## 4. ReplaceContribution

The authoritative `publication` producer combines assignment and access state into **one increasing contribution revision**. Do not compare max(assignmentRevision,policyRevision): they are different dimensions.

1. BEGIN and lock the contribution `(scope,messageId)`; handle the initial INSERT as described above.
2. Lower revision: no-op. Equal revision and matching digest: no-op. Equal revision and different digest: error.
3. Read the previous contribution from the database. Do not assume event.previous matches the revision applied locally.
4. Identify the previous and new aircraft IDs and lock their records in a deterministic order.
5. Replace the contribution or write a tombstone.
6. For both aircraft, select the latest active, permitted contribution; compute freshness and the next deadline.
7. Persist the new state revision, expiry job and outbox entry.
8. COMMIT.

Separating the state of the two aircraft into different shards requires an additional convergence model; this guarantee does not automatically extend across a network.

## 5. Expiry

The job contains scope, aircraftId, expectedRevision and dueAt. The transaction reads the state and verifies both the revision and deadline. If the message has changed in the meantime, the job completes as stale/no-op. If the deadline has not arrived, it performs no transition. After a long pause, it computes the state for the current time and may skip an intermediate color.

An API read may additionally compute freshness from lastObservedAt and serverNow, but this does not replace updates to map indexes/filters. A timer and repair of overdue state are still required.

## 6. Consistent projection snapshot

The map writer maintains the changed map rows, the locked stream_heads counter and the change_log for that revision in a single commit. Serializing the counter prevents publishing a checkpoint that conceals an uncommitted lower revision.

Under REPEATABLE READ, the reader obtains checkpoint C and the map rows from the same snapshot. The gateway is already buffering live updates, and the log supports replay after C. Snapshot construction does not use SKIP LOCKED. A client returning with an unknown generation or an expired cursor requires a new snapshot.

## 7. Integration tests required before deployment

- Two processes committing from the same expectedRevision: exactly one succeeds.
- Two initial INSERTs without an existing head row: one winner, no duplicate revision 1.
- An outbox INSERT failure rolls back the domain write.
- Repeated consumption after a lost ACK does not increment counters.
- Two different consumerId values process the same event.
- An outbox ID allocated earlier but committed later is not skipped by the dispatcher.
- An expired lease cannot mark another worker's work DONE.
- A transfer A→B and concurrent expiry do not leave invalid state.
- Snapshot and delta delivery during concurrent writes cover each change exactly once semantically, allowing delivery deduplication.
