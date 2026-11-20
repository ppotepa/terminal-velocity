-- Additive private storage. Applied once under the existing migration lock.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tv_source_ingestion_owner') THEN
    BEGIN
      CREATE ROLE tv_source_ingestion_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL; -- Roles are shared across databases in the cluster.
    END;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('tv_source_ingestion_owner','tv_runtime')
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
    OR EXISTS (SELECT FROM pg_auth_members JOIN pg_roles ON pg_roles.oid = member
      WHERE rolname IN ('tv_source_ingestion_owner','tv_runtime'))
    OR EXISTS (SELECT FROM pg_auth_members WHERE roleid = 'tv_source_ingestion_owner'::regrole)
  THEN RAISE EXCEPTION 'Unsafe source schema owner or runtime role'; END IF;
END
$roles$;

CREATE SCHEMA source_ingestion AUTHORIZATION tv_source_ingestion_owner;
REVOKE ALL ON SCHEMA source_ingestion FROM PUBLIC;
SET LOCAL ROLE tv_source_ingestion_owner;

CREATE DOMAIN source_ingestion.utc_ms AS bigint CHECK (VALUE BETWEEN 0 AND 9007199254740991);
CREATE DOMAIN source_ingestion.opaque_id AS text CHECK (
  length(VALUE) BETWEEN 1 AND 256 AND VALUE !~ '[[:cntrl:]]|^[[:space:]]|[[:space:]]$'
);
CREATE DOMAIN source_ingestion.time_precision AS text
  CHECK (VALUE IN ('MILLISECOND','SECOND','MINUTE','HOUR','DAY','UNKNOWN'));

CREATE TABLE source_ingestion.deliveries (
  delivery_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL CHECK (source_id ~ '^src_[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$'),
  provider_id text NOT NULL CHECK (provider_id ~ '^[a-z0-9][a-z0-9._+-]{0,63}$'),
  account_scope source_ingestion.opaque_id NOT NULL CHECK (length(account_scope) <= 128),
  source_epoch source_ingestion.opaque_id NOT NULL CHECK (length(source_epoch) <= 128),
  external_id source_ingestion.opaque_id NOT NULL,
  UNIQUE (source_id, provider_id, account_scope, source_epoch, external_id),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  data_level text NOT NULL CHECK (data_level IN ('PROVIDER_MESSAGE','RECEPTION','FRAME')),
  UNIQUE (delivery_id, data_level),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  capabilities_revision bigint NOT NULL CHECK (capabilities_revision BETWEEN 1 AND 9007199254740991),
  decoder_version text CHECK (decoder_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$'),
  received_at_ms source_ingestion.utc_ms NOT NULL,
  received_basis text NOT NULL CHECK (received_basis IN ('RECEIVED','PROVIDER')),
  received_precision source_ingestion.time_precision NOT NULL,
  received_uncertainty_ms bigint NOT NULL CHECK (received_uncertainty_ms BETWEEN 0 AND 31536000000),
  observed_at_ms source_ingestion.utc_ms,
  observed_basis text CHECK (observed_basis IN ('OBSERVED','PROVIDER')),
  observed_precision source_ingestion.time_precision,
  observed_uncertainty_ms bigint CHECK (observed_uncertainty_ms BETWEEN 0 AND 31536000000),
  CHECK (num_nonnulls(observed_at_ms, observed_basis, observed_precision, observed_uncertainty_ms) IN (0,4)),
  CHECK (observed_at_ms - observed_uncertainty_ms <= received_at_ms + received_uncertainty_ms),
  retrieved_at_ms source_ingestion.utc_ms NOT NULL,
  ingested_at_ms source_ingestion.utc_ms NOT NULL,
  CHECK (retrieved_at_ms <= ingested_at_ms),
  provenance jsonb NOT NULL CHECK ((jsonb_typeof(provenance) = 'object'
    AND provenance - ARRAY['pageUrl','parserVersion'] = '{}'::jsonb
    AND jsonb_typeof(provenance->'pageUrl') = 'string'
    AND provenance->>'pageUrl' ~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?/[^?#[:cntrl:][:space:]]*$'
    AND jsonb_typeof(provenance->'parserVersion') = 'string'
    AND provenance->>'parserVersion' ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$') IS TRUE),
  retention text NOT NULL DEFAULT 'METADATA_ONLY' CHECK (retention = 'METADATA_ONLY'),
  state text NOT NULL CHECK (state IN ('ACCEPTED','QUARANTINED')),
  quarantine_reason source_ingestion.opaque_id,
  CHECK ((state = 'QUARANTINED') = (quarantine_reason IS NOT NULL))
);
CREATE INDEX delivery_source_time ON source_ingestion.deliveries
  (source_id, provider_id, account_scope, source_epoch, received_at_ms, delivery_id);
CREATE INDEX quarantined_source_deliveries ON source_ingestion.deliveries (source_id, ingested_at_ms, delivery_id)
  WHERE state = 'QUARANTINED';

CREATE TABLE source_ingestion.provider_message_observations (
  delivery_id uuid PRIMARY KEY,
  data_level text NOT NULL DEFAULT 'PROVIDER_MESSAGE' CHECK (data_level = 'PROVIDER_MESSAGE'),
  direction text CHECK (direction IN ('UPLINK','DOWNLINK','BIDIRECTIONAL','UNKNOWN')),
  bearer text CHECK (bearer ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$'),
  FOREIGN KEY (delivery_id, data_level) REFERENCES source_ingestion.deliveries(delivery_id, data_level)
);
CREATE TABLE source_ingestion.receptions (
  delivery_id uuid PRIMARY KEY,
  data_level text NOT NULL DEFAULT 'RECEPTION' CHECK (data_level = 'RECEPTION'),
  receiver_id source_ingestion.opaque_id NOT NULL CHECK (length(receiver_id) <= 128),
  frequency_hz bigint CHECK (frequency_hz BETWEEN 1 AND 1000000000000),
  signal_strength_dbm double precision CHECK (signal_strength_dbm BETWEEN -200 AND 100),
  FOREIGN KEY (delivery_id, data_level) REFERENCES source_ingestion.deliveries(delivery_id, data_level)
);

CREATE TABLE source_ingestion.outbox (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES source_ingestion.deliveries(delivery_id),
  stream_revision bigint NOT NULL CHECK (stream_revision BETWEEN 1 AND 9007199254740991),
  event_type text NOT NULL CHECK (event_type = 'source.delivery-accepted.v1'),
  payload jsonb NOT NULL CHECK (payload = jsonb_build_object('deliveryId', delivery_id)),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  fanout_completed_at timestamptz,
  UNIQUE (delivery_id, stream_revision)
);
CREATE INDEX pending_source_events ON source_ingestion.outbox (recorded_at, event_id)
  WHERE fanout_completed_at IS NULL;

GRANT USAGE ON SCHEMA source_ingestion TO tv_runtime;
GRANT SELECT, INSERT ON source_ingestion.deliveries, source_ingestion.receptions,
  source_ingestion.provider_message_observations, source_ingestion.outbox TO tv_runtime;
GRANT UPDATE (fanout_completed_at) ON source_ingestion.outbox TO tv_runtime;
RESET ROLE;
