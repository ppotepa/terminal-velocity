-- A registry connects delivery identities to their actual immutable producer rows.
GRANT USAGE ON SCHEMA source_ingestion TO tv_delivery_owner;
GRANT REFERENCES (event_id) ON source_ingestion.outbox TO tv_delivery_owner;
SET LOCAL ROLE tv_delivery_owner;
CREATE TABLE event_delivery.events (
  event_id text PRIMARY KEY CHECK (event_id ~ '^evt_[a-zA-Z0-9-]{1,100}$'),
  correlation_event_id text UNIQUE REFERENCES correlation.outbox(event_id),
  source_event_id uuid UNIQUE REFERENCES source_ingestion.outbox(event_id),
  CHECK (num_nonnulls(correlation_event_id, source_event_id) = 1),
  CHECK (correlation_event_id IS NULL OR event_id = correlation_event_id),
  CHECK (source_event_id IS NULL OR event_id = 'evt_source-' || source_event_id::text)
);
RESET ROLE;
INSERT INTO event_delivery.events(event_id,correlation_event_id)
  SELECT event_id,event_id FROM correlation.outbox;
INSERT INTO event_delivery.events(event_id,source_event_id)
  SELECT 'evt_source-' || event_id::text,event_id FROM source_ingestion.outbox;
SET LOCAL ROLE tv_delivery_owner;
ALTER TABLE event_delivery.deliveries DROP CONSTRAINT deliveries_event_id_fkey;
ALTER TABLE event_delivery.deliveries ADD FOREIGN KEY (event_id) REFERENCES event_delivery.events(event_id);
GRANT SELECT, INSERT ON event_delivery.events TO tv_runtime;
RESET ROLE;

GRANT USAGE ON SCHEMA correlation TO tv_source_ingestion_owner;
GRANT REFERENCES (message_id,revision) ON correlation.aircraft_link_revisions TO tv_source_ingestion_owner;
SET LOCAL ROLE tv_source_ingestion_owner;
ALTER TABLE source_ingestion.outbox ADD COLUMN normalized_v1_sha256 text
  CHECK (normalized_v1_sha256 ~ '^[a-f0-9]{64}$');
-- No live retention permission exists. Only the explicit synthetic composition writes here.
CREATE TABLE source_ingestion.synthetic_inputs (
  delivery_id uuid PRIMARY KEY REFERENCES source_ingestion.deliveries(delivery_id),
  canonical jsonb NOT NULL CHECK (jsonb_typeof(canonical) = 'object'),
  CHECK ((canonical #>> '{observation,sourceDeliveryId,provider}' = 'synthetic') IS TRUE),
  CHECK ((canonical #>> '{observation,sourceId}' = 'src_synthetic') IS TRUE)
);
CREATE TABLE source_ingestion.message_revisions (
  message_id text NOT NULL CHECK (message_id ~ '^msg_[a-zA-Z0-9-]{1,64}$'),
  revision bigint NOT NULL CHECK (revision = 1),
  source_delivery_id uuid NOT NULL UNIQUE REFERENCES source_ingestion.synthetic_inputs(delivery_id),
  transformation_id text NOT NULL CHECK (transformation_id = 'provider-message/1'),
  canonical jsonb NOT NULL CHECK (jsonb_typeof(canonical) = 'object'),
  PRIMARY KEY (message_id, revision)
);
CREATE TABLE source_ingestion.message_sources (
  message_id text NOT NULL,
  message_revision bigint NOT NULL DEFAULT 1,
  source_delivery_id uuid PRIMARY KEY REFERENCES source_ingestion.synthetic_inputs(delivery_id),
  decision_revision bigint NOT NULL,
  FOREIGN KEY (message_id,decision_revision) REFERENCES correlation.aircraft_link_revisions(message_id,revision),
  FOREIGN KEY (message_id,message_revision) REFERENCES source_ingestion.message_revisions(message_id,revision)
);
CREATE INDEX message_sources_message ON source_ingestion.message_sources(message_id,message_revision);
CREATE TABLE source_ingestion.import_quarantine (
  source_delivery_id uuid PRIMARY KEY REFERENCES source_ingestion.deliveries(delivery_id),
  reason text NOT NULL CHECK (reason IN ('RETENTION_NOT_PERMITTED','INVALID_CANONICAL','UNSUPPORTED_LEVEL','MISSING_OBSERVATION_TIME','IDENTITY_CONFLICT'))
);
-- Private contributions never feed availability.contributions or demo counts/statuses.
CREATE TABLE source_ingestion.private_contributions (
  message_id text PRIMARY KEY,
  message_revision bigint NOT NULL DEFAULT 1,
  decision_revision bigint NOT NULL CHECK (decision_revision BETWEEN 1 AND 9007199254740991),
  aircraft_id text CHECK (aircraft_id ~ '^ac_[a-zA-Z0-9-]{1,64}$'),
  observed_at_ms source_ingestion.utc_ms NOT NULL,
  FOREIGN KEY (message_id,message_revision) REFERENCES source_ingestion.message_revisions(message_id,revision),
  FOREIGN KEY (message_id,decision_revision) REFERENCES correlation.aircraft_link_revisions(message_id,revision)
);
CREATE INDEX private_contributions_aircraft ON source_ingestion.private_contributions(aircraft_id,observed_at_ms DESC)
  WHERE aircraft_id IS NOT NULL;
GRANT SELECT, INSERT ON source_ingestion.message_sources, source_ingestion.synthetic_inputs, source_ingestion.message_revisions,
  source_ingestion.import_quarantine TO tv_runtime;
GRANT SELECT, INSERT, UPDATE ON source_ingestion.private_contributions TO tv_runtime;
RESET ROLE;
