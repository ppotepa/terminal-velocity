# Private provider message pipeline (#11)

The engineering path uses **synthetic records only**. `createSyntheticProviderPipeline`
composes the existing normalization and acceptance use cases, the source consumer,
correlation, and a separate private availability consumer. It is exercised by
`npm run test:postgres:local` (or `npm run test:integration` against the isolated test
instance). There is no new HTTP endpoint, provider account, live retention grant,
or publication grant. The provider API adapter remains inactive.

`npm run messages -- crawl ICAO24` still uses the rendered Airframes reader and
returns observations transiently. Its production reader and command were not
replaced with fixtures. The ordinary source acceptance transaction still stores
metadata only. `acceptFixture` explicitly requires source `src_synthetic` and
provider `synthetic`; it is not a permission switch for Airframes. Actual provider
retention and an approved private ingestion entry point remain external acceptance
gates. Labels are fixture configuration, not evidence of real source rights.

## Commit and acknowledgment boundaries

1. Source acceptance: delivery metadata and `source.delivery-accepted.v1` outbox
   commit together. The explicit fixture path also writes its canonical normalized
   snapshot and digest in this transaction. A successful callback/fixture receipt
   guarantees this commit only; it does not guarantee correlation or availability.
   No existing HTTP ACK has gained a stronger guarantee.
2. Source import: `provider-message-import-v1` locks its delivery lease. Its inbox
   digest, immutable message revision, source links, correlation revision/head,
   correlation outbox and SQL delivery ACK commit on that same checked-out
   connection. Incomplete candidate sets or failed SQL/outbox writes abort all
   these effects. Unsupported levels, missing observation time, absent retention
   permission and conflicting provider identities produce durable quarantine
   receipts without message effects. A semantic quarantine completes consumption;
   its reason is in `source_ingestion.import_quarantine`.
3. Private projection: `provider-private-availability-v1` consumes the correlation
   event independently. Its inbox, private contribution/tombstone and ACK commit
   together. A lost response after COMMIT is safe to retry. A death before COMMIT
   leaves no partial effects. Expired leases recover using the existing queue;
   stale tokens cannot acknowledge a new lease.

`drain()` runs bounded batches, recovers expired leases and routes both fixed
subscriptions. Processing failures schedule retry using the Stage2 attempt budget;
identity-digest collisions quarantine the queue entry. The composition owns no
background timer or connection pool lifecycle: callers supply/close the pool.
The API's existing demo worker does not start this fixture worker.

## Identity, revision and evidence

Logical message IDs hash the stable tuple `provider-message/1`, source ID,
provider, account scope, source epoch and **original provider message ID**
(`provenance.originalSourceId`). Text is never an identity. Distinct provider IDs
retain distinct messages even when text and observation time are equal. Reusing
one provider ID for different observation times/content in the same epoch is an
identity conflict, not permission to overwrite a transmission. Sources that reuse
IDs need a truthful new epoch or a transmission-specific source ID.

Different delivery IDs for the same unchanged provider fact share one immutable
message revision. `message_sources` records every accepted link, its message
revision and the exact decision revision observed by that import. Deduplication
excludes transport delivery IDs, their envelope digests and retrieval/ingestion
clocks; it includes observation/receipt evidence, decoded content, normalized
identifiers, protocol, source/decoder versions and original provenance. The
first canonical revision remains unchanged. Replays return its stored import
receipt rather than generating another decision. Source acceptance additionally
checks full normalized facts, including registration omitted by the older
observation envelope, so a changed registration cannot replay an earlier receipt.

Message revision is currently 1; transformation identity is `provider-message/1`.
Decision revisions are independent and retain the current correlation policy,
candidate evaluations and directory revision. `UNMATCHED`, `AMBIGUOUS` and
`CONFLICTED` remain explicit outcomes. No station, RF occurrence, receiver,
flight session or coverage evidence is inferred from a provider message.

Private contributions refer to message and decision revisions separately. They
support corrections, stale-event suppression and tombstones. Freshness derives
from observation time, never the retry/import time. This private fixture scope
has no mutable publication grant; a future publication contribution needs its
own authoritative revision. The existence of a private message never supplies a
public count, list entry or freshness indicator. Demo message reads use
`message_ingestion.messages`; demo availability uses `availability.contributions`.
Provider facts and contributions live in separate source-owned tables.

## Migration 004 and producer routing

`004_source_event_delivery_bridge.sql` adds `event_delivery.events`, an immutable
registry with exactly one FK to the actual source or correlation producer row.
Correlation IDs remain unchanged; source UUIDs are mapped to `evt_source-UUID`.
Each producer retains its schema, payload and checkpoint. A source event is never
inserted into the correlation outbox. Producer-specific readers validate their
canonical envelope and calculate its inbox digest.

The migration backfills registry rows before replacing the delivery FK. Existing
leases, attempts, consumer inboxes, DONE rows and pending Stage2 events remain in
place. New fan-out inserts registry identities, deliveries and checkpoints in one
transaction. The legacy fan-out excludes provider decisions; the source router
sends those only to the private consumer. Event-ID collisions fail closed.
The runtime can insert/read registry rows, not update/delete their provenance.

Apply migrations with the existing schema-owner runner before using the new
binary. The API checks schema access but never migrates. Stop old dispatchers
before migration: an old dispatcher does not register new correlation events.
There is no automatic destructive down migration. A rollback to old code requires
an owner-reviewed database recovery plan because the former FK cannot represent
source events. Prefer a forward fix; do not delete source events or inboxes to
make an old binary start. No migration was executed on a hosted database here.

## Inspect lineage and prepare replay for #12

This is an internal, privileged query, not a REST response. `$1` is the logical
message ID. It shows every source link and the original import decision; current
private status can reference a later correction independently.

```sql
SELECT m.message_id, m.revision AS message_revision, m.transformation_id,
       s.decision_revision AS import_decision_revision,
       d.delivery_id, d.source_id, d.provider_id, d.account_scope, d.source_epoch,
       d.external_id, d.payload_sha256, d.observed_at_ms, d.received_at_ms,
       d.capabilities_revision, d.decoder_version, d.provenance,
       se.event_id AS source_event_id, se.canonical_v1_sha256, se.normalized_v1_sha256,
       r.directory_revision, r.decision, ce.event_id AS import_decision_event_id,
       c.decision_revision AS status_decision_revision, c.aircraft_id
FROM source_ingestion.message_revisions m
JOIN source_ingestion.message_sources s
  ON s.message_id=m.message_id AND s.message_revision=m.revision
JOIN source_ingestion.deliveries d ON d.delivery_id=s.source_delivery_id
JOIN source_ingestion.outbox se ON se.delivery_id=d.delivery_id AND se.stream_revision=1
JOIN correlation.aircraft_link_revisions r
  ON r.message_id=s.message_id AND r.revision=s.decision_revision
JOIN correlation.outbox ce ON ce.stream_key=r.message_id AND ce.stream_revision=r.revision
LEFT JOIN source_ingestion.private_contributions c ON c.message_id=m.message_id
WHERE m.message_id=$1;
```

Inspect queue state by registry ID and consumer ID. A transport retry uses the
same immutable event and inbox identity. A DONE delivery already has committed
effects; replay must not delete its inbox. Semantic quarantines need their stated
condition resolved, not a bypass of retention checks. A future transformation
change needs a deliberate revision/migration contract; changing a consumer name
alone does not authorize new facts. #12 owns operational replay controls; this
issue does not start that work.

The executable matrix and actual local results are recorded in
[the #11 handoff](handoffs/issue-11.md). PostgreSQL tests are present but were not
executed in this root/sandbox environment; their outcomes remain unverified.
