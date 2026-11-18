# Invariants and failure scenarios

**Distinction:** this file describes the required checks for the complete future application. Tests actually run in this iteration are listed in `../VERIFICATION.md` and `../reference/VERIFICATION.md`.

| Area | Scenario | Expected result | Where to verify |
|---|---|---|---|
| Source deliveries | Event retried after reconnect | One delivery effect | Contract + DB |
| Source deliveries | Same ID, different payload | Conflict with evidence retained | Contract + DB |
| Reception | The same transmission received by 3 stations | 3 receptions, one frame occurrence hypothesis | Domain + DB |
| Deduplication | Identical text at separate times | Do not merge without protocol evidence | Domain |
| Deduplication | Two receptions on opposite sides of a bucket boundary | Candidates found in adjacent intervals | Domain + DB |
| Deduplication | Concurrent get-or-create of an occurrence | One correct result or an explicit conflict/retry | DB with 2 processes |
| Reassembly | Fragments 3,1,2 | Assemble only under a policy that permits out-of-order input | Decoder contract |
| Reassembly | Different content for the same sequence | Conflict, not a silent overwrite | Domain |
| Reassembly | Missing final fragment | Session expires with an incomplete state | Domain + worker |
| Input | Provider supplies only a message summary | No fabricated frame or station | Contract |
| Protocol | VDL2 without ACARS | Correct protocol stack | Decoder contract |
| Identity | Strong ID and no flight session | Aircraft identified; flight remains unknown | Reference + integration |
| Identity | Alias ownership changes over time | Historical time selects the historical association | Reference |
| Identity | Two different active aliases of the same kind | Explicit catalog conflict under the policy | Reference |
| Identity | The same AircraftId appears twice in a snapshot | Reject the inconsistent set; do not bypass the veto | Reference |
| Correlation | Callsign without strong evidence | No false MATCHED | Reference |
| Correlation | Two equally valid candidates | AMBIGUOUS | Reference |
| Correlation | Partially retrieved catalog | Retry/INCOMPLETE, not UNMATCHED | Reference |
| Correlation | Catalog version changes during the operation | Retain the revision used and schedule reevaluation | Integration |
| Availability | Revisions 1,3,2,3 | State from 3; older and duplicate revisions have no effect | Reference |
| Availability | Same revision, different content | REVISION_COLLISION | Reference |
| Availability | Assignment A→B | Both aircraft are recalculated | Reference |
| Availability | Latest message retracted | Select the preceding eligible message | Reference |
| Availability | Old assignment arrives after retraction | Tombstone prevents restoring the contribution | Reference |
| Availability | Caller mutates the accepted object | The accepted ledger does not change through the input reference | Reference |
| Time | Exactly 10 minutes | STALE | Reference |
| Time | Exactly 60 minutes | NONE | Reference |
| Time | New message arrives before an old timer executes | The old job does not change the newer revision | Reference |
| Time | Worker restarts after 2 hours | Move directly to the correct status for the current time | Reference + worker |
| Time | Backfill of an old message | Does not refresh status based on ingestion time | Reference |
| Time | Timestamp outside the trusted range | Reject or record a quality state; no new green marker | Boundary + domain |
| Feed | Sampled feed remains connected | Coverage sampled, health healthy | Reference + connector |
| Feed | Connection lost | Separate health state; historical time remains unchanged | Reference + connector |
| Publication | Private message | Does not change public content, counts or status | Partial reference coverage + E2E |
| Publication | Grant revoked after a snapshot was sent | Gate blocks replay; remove/resync for the client | E2E |
| Publication | Same content from public and private sources | Does not disclose private receptions or stations | Integration |
| Revisions | assignment r7, grant r3 | Independent contributionRevision; no comparison between different counters | Contract |
| Transactions | Failure during outbox append | Rollback of the decision and event | Reference + DB |
| Transactions | Two writes with expectedRevision N | One succeeds; the other conflicts or retries | Reference + multiprocess DB |
| Transactions | Concurrent first INSERT | Uniqueness/CAS also applies when the head does not exist | DB |
| Delivery | Crash after commit, before ACK | No duplicate effect | DB + broker/worker |
| Delivery | One event and two consumers | Both effects occur independently | DB |
| Delivery | Lower ID commits after a higher ID | Dispatcher skips nothing | DB |
| Delivery | Lease expires and another worker takes over | The old token cannot commit the new worker's work | DB |
| Projections | Replay with a new policy | New generation and controlled cutover | Integration |
| WS | Event arrives between snapshot and live delivery startup | Delivered through replay after the checkpoint | Integration/E2E |
| WS | bbox/filter changes while processing is in flight | Old generation is ignored | Client reducer + E2E |
| WS | Aircraft leaves the bbox | remove; no ghost aircraft on the map | E2E |
| WS | Cursor retention expires | resync.required | Integration/E2E |
| WS | Slow client | Bounded buffer; coalesce positions or resync | Load |
| Architecture | Domain imports app/infrastructure | Gate rejects the import | Architecture check |
| Architecture | Two domains import each other's internals | Gate rejects the deep import and cycle | Architecture check |

## Meaningful metrics

- `source_ingest_lag_seconds`: separate measurements per source and timestamp quality;
- `correlation_decisions_total{status,reason,policy}`: conflict and ambiguity are not hidden within success;
- `correlation_candidate_incomplete_total`: an unready index, not a false UNMATCHED;
- `assignment_retractions_total` and `availability_repairs_total`;
- `outbox_oldest_unrouted_seconds`, `delivery_lag_seconds{consumer}`, `delivery_attempts`;
- `expiry_overdue_seconds`: status-transition delay when no new messages arrive;
- `projection_checkpoint_age_seconds` and `ws_resync_total{reason}`;
- `publication_revocation_lag_seconds`: time to remove a view after a grant is revoked.

Do not label metrics with every messageId or aircraftId: that risks uncontrolled cardinality. Such details belong in bounded logs or traces governed by the appropriate content policy.
