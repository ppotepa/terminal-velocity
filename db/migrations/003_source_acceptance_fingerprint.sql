-- Source outbox revision 1 attests to the immutable canonical facts accepted with its delivery.
-- Older storage-only rows have no such evidence; they cannot establish an exact replay.
SET LOCAL ROLE tv_source_ingestion_owner;
ALTER TABLE source_ingestion.outbox ADD COLUMN canonical_v1_sha256 text
  CHECK (canonical_v1_sha256 ~ '^[a-f0-9]{64}$');
RESET ROLE;
