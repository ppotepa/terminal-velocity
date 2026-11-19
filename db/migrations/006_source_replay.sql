-- Metadata only. Cursor contents are private and never included in admin output.
SET LOCAL ROLE tv_source_ingestion_owner;
CREATE TABLE source_ingestion.replay_checkpoints (
  scope_key text PRIMARY KEY CHECK (length(scope_key) BETWEEN 1 AND 512),
  checkpoint jsonb NOT NULL CHECK (jsonb_typeof(checkpoint) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (checkpoint->>'state' IN ('READY','COMPLETE','QUARANTINED')),
  CHECK ((checkpoint->>'requests')::integer BETWEEN 0 AND 100),
  CHECK ((checkpoint->>'processed')::integer BETWEEN 0 AND 500)
);
REVOKE ALL ON source_ingestion.replay_checkpoints FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON source_ingestion.replay_checkpoints TO tv_runtime;
RESET ROLE;
