-- Initial storage for the synthetic Stage 2 flow. Run through the migration CLI.
DO $roles$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'tv_ingestion_owner', 'tv_correlation_owner', 'tv_delivery_owner',
    'tv_availability_owner', 'tv_runtime'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      BEGIN
        EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', role_name);
      EXCEPTION WHEN duplicate_object OR unique_violation THEN
        -- Roles are cluster-wide; another isolated database may initialize them concurrently.
        NULL;
      END;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = role_name
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    ) THEN
      RAISE EXCEPTION 'Role % has incompatible privileges', role_name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_auth_members membership
      JOIN pg_roles member_role ON member_role.oid = membership.member
      WHERE member_role.rolname = role_name
    ) THEN
      RAISE EXCEPTION 'Role % has unexpected inherited role membership', role_name;
    END IF;
  END LOOP;
END
$roles$;

CREATE SCHEMA message_ingestion AUTHORIZATION tv_ingestion_owner;
CREATE SCHEMA correlation AUTHORIZATION tv_correlation_owner;
CREATE SCHEMA event_delivery AUTHORIZATION tv_delivery_owner;
CREATE SCHEMA availability AUTHORIZATION tv_availability_owner;
REVOKE ALL ON SCHEMA message_ingestion, correlation, event_delivery, availability FROM PUBLIC;

SET LOCAL ROLE tv_ingestion_owner;
CREATE TABLE message_ingestion.messages (
  message_id text PRIMARY KEY CHECK (message_id ~ '^msg_[a-zA-Z0-9-]{1,64}$'),
  canonical jsonb NOT NULL CHECK (jsonb_typeof(canonical) = 'object'),
  observed_at_ms bigint NOT NULL CHECK (observed_at_ms BETWEEN 0 AND 9007199254740991),
  received_at_ms bigint NOT NULL CHECK (received_at_ms BETWEEN 0 AND 9007199254740991),
  CHECK ((jsonb_typeof(canonical -> 'messageId') = 'string'
    AND canonical ->> 'messageId' = message_id) IS TRUE),
  CHECK ((jsonb_typeof(canonical -> 'observedAt') = 'number'
    AND (canonical ->> 'observedAt')::numeric = observed_at_ms) IS TRUE)
);
GRANT USAGE ON SCHEMA message_ingestion TO tv_runtime;
GRANT SELECT, INSERT ON message_ingestion.messages TO tv_runtime;
RESET ROLE;

SET LOCAL ROLE tv_correlation_owner;
CREATE TABLE correlation.aircraft_link_revisions (
  message_id text NOT NULL CHECK (message_id ~ '^msg_[a-zA-Z0-9-]{1,64}$'),
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  decided_at_ms bigint NOT NULL CHECK (decided_at_ms BETWEEN 0 AND 9007199254740991),
  directory_revision text NOT NULL CHECK (length(directory_revision) > 0),
  decision jsonb NOT NULL CHECK (jsonb_typeof(decision) = 'object'),
  PRIMARY KEY (message_id, revision),
  CHECK ((decision ->> 'messageId' = message_id) IS TRUE),
  CHECK ((decision ->> 'status' IN ('MATCHED', 'UNMATCHED', 'AMBIGUOUS', 'CONFLICTED')) IS TRUE),
  CHECK (decision ->> 'status' <> 'MATCHED'
    OR (decision ->> 'aircraftId' ~ '^ac_[a-zA-Z0-9-]{1,64}$') IS TRUE)
);
CREATE TABLE correlation.aircraft_link_heads (
  message_id text PRIMARY KEY,
  revision bigint NOT NULL,
  FOREIGN KEY (message_id, revision)
    REFERENCES correlation.aircraft_link_revisions (message_id, revision)
);
CREATE TABLE correlation.outbox (
  event_id text PRIMARY KEY CHECK (event_id ~ '^evt_[a-zA-Z0-9-]{1,100}$'),
  event_type text NOT NULL CHECK (event_type = 'correlation.aircraft-decision-revised.v1'),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  stream_key text NOT NULL,
  stream_revision bigint NOT NULL,
  occurred_at_ms bigint NOT NULL CHECK (occurred_at_ms BETWEEN 0 AND 9007199254740991),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  fanout_completed_at timestamptz,
  UNIQUE (stream_key, stream_revision, event_type),
  FOREIGN KEY (stream_key, stream_revision)
    REFERENCES correlation.aircraft_link_revisions (message_id, revision),
  CHECK ((payload #>> '{decision,messageId}' = stream_key) IS TRUE),
  CHECK ((jsonb_typeof(payload -> 'revision') = 'number'
    AND (payload ->> 'revision')::numeric = stream_revision) IS TRUE),
  CHECK ((jsonb_typeof(payload -> 'decidedAt') = 'number'
    AND (payload ->> 'decidedAt')::numeric = occurred_at_ms) IS TRUE)
);
CREATE INDEX outbox_pending_fanout ON correlation.outbox (recorded_at, event_id)
  WHERE fanout_completed_at IS NULL;
GRANT USAGE ON SCHEMA correlation TO tv_runtime, tv_delivery_owner;
GRANT SELECT, INSERT ON correlation.aircraft_link_revisions, correlation.outbox TO tv_runtime;
GRANT SELECT, INSERT, UPDATE ON correlation.aircraft_link_heads TO tv_runtime;
GRANT UPDATE (fanout_completed_at) ON correlation.outbox TO tv_runtime;
GRANT REFERENCES (event_id) ON correlation.outbox TO tv_delivery_owner;
RESET ROLE;

SET LOCAL ROLE tv_delivery_owner;
CREATE TABLE event_delivery.deliveries (
  consumer_id text NOT NULL CHECK (consumer_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  event_id text NOT NULL REFERENCES correlation.outbox (event_id),
  state text NOT NULL DEFAULT 'READY'
    CHECK (state IN ('READY', 'LEASED', 'DONE', 'QUARANTINED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_until timestamptz,
  last_failure_code text CHECK (last_failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  completed_at timestamptz,
  PRIMARY KEY (consumer_id, event_id),
  CHECK ((state = 'LEASED' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (state <> 'LEASED' AND lease_token IS NULL AND lease_until IS NULL)),
  CHECK ((state = 'DONE') = (completed_at IS NOT NULL))
);
CREATE INDEX deliveries_ready ON event_delivery.deliveries (consumer_id, next_attempt_at, event_id)
  WHERE state = 'READY';
CREATE INDEX deliveries_leased ON event_delivery.deliveries (lease_until, consumer_id, event_id)
  WHERE state = 'LEASED';
CREATE TABLE event_delivery.consumer_inbox (
  consumer_id text NOT NULL CHECK (consumer_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  event_id text NOT NULL CHECK (event_id ~ '^evt_[a-zA-Z0-9-]{1,100}$'),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (consumer_id, event_id)
);
GRANT USAGE ON SCHEMA event_delivery TO tv_runtime;
GRANT SELECT, INSERT, UPDATE ON event_delivery.deliveries TO tv_runtime;
GRANT SELECT, INSERT ON event_delivery.consumer_inbox TO tv_runtime;
RESET ROLE;

SET LOCAL ROLE tv_availability_owner;
CREATE TABLE availability.contributions (
  message_id text PRIMARY KEY CHECK (message_id ~ '^msg_[a-zA-Z0-9-]{1,64}$'),
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  aircraft_id text,
  observed_at_ms bigint,
  bearer text,
  CHECK ((aircraft_id IS NULL AND observed_at_ms IS NULL AND bearer IS NULL)
    OR (aircraft_id IS NOT NULL AND aircraft_id ~ '^ac_[a-zA-Z0-9-]{1,64}$'
      AND observed_at_ms IS NOT NULL AND observed_at_ms BETWEEN 0 AND 9007199254740991
      AND bearer IS NOT NULL AND bearer IN ('VHF_ACARS', 'VDL2', 'HFDL', 'SATCOM')))
);
CREATE INDEX contributions_latest_aircraft ON availability.contributions (aircraft_id, observed_at_ms DESC)
  WHERE aircraft_id IS NOT NULL;
GRANT USAGE ON SCHEMA availability TO tv_runtime;
GRANT SELECT, INSERT, UPDATE ON availability.contributions TO tv_runtime;
RESET ROLE;
