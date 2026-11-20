-- Append-only private position history. Real adsb.lol rows remain gated on issue #46.
DO $tracking_role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tv_tracking_owner') THEN
    BEGIN
      CREATE ROLE tv_tracking_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL;
    END;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'tv_tracking_owner'
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Role tv_tracking_owner has incompatible privileges';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members membership
    JOIN pg_roles member_role ON member_role.oid = membership.member
    WHERE member_role.rolname = 'tv_tracking_owner'
  ) THEN
    RAISE EXCEPTION 'Role tv_tracking_owner has unexpected inherited role membership';
  END IF;
END
$tracking_role$;

CREATE SCHEMA tracking AUTHORIZATION tv_tracking_owner;
REVOKE ALL ON SCHEMA tracking FROM PUBLIC;

SET LOCAL ROLE tv_tracking_owner;
CREATE TABLE tracking.position_observations (
  observation_id uuid NOT NULL UNIQUE,
  source_id text NOT NULL CHECK (source_id ~ '^src_[A-Za-z0-9][A-Za-z0-9._-]{0,62}$'),
  source_observation_id text NOT NULL
    CHECK (length(source_observation_id) BETWEEN 1 AND 256
      AND source_observation_id = btrim(source_observation_id)
      AND source_observation_id !~ '[[:cntrl:]]'),
  source_delivery_ref text CHECK (source_delivery_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'),
  observed_at_ms bigint NOT NULL CHECK (observed_at_ms BETWEEN 0 AND 9007199254740991),
  ingested_at_ms bigint NOT NULL CHECK (ingested_at_ms BETWEEN 0 AND 9007199254740991),
  measurement_kind text NOT NULL CHECK (measurement_kind IN ('ADS_B', 'MLAT', 'OTHER')),
  quality jsonb CHECK (quality IS NULL OR jsonb_typeof(quality) = 'object'),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  fact jsonb NOT NULL CHECK (jsonb_typeof(fact) = 'object'),
  position point GENERATED ALWAYS AS (point(longitude, latitude)) STORED,
  icao24_hint text GENERATED ALWAYS AS (
    CASE WHEN jsonb_typeof(fact #> '{identifierHints,icao24}') = 'string'
      THEN fact #>> '{identifierHints,icao24}' ELSE NULL END
  ) STORED,
  PRIMARY KEY (source_id, source_observation_id),
  CHECK ((fact ->> 'schemaVersion' = '1') IS TRUE),
  CHECK ((fact ->> 'sourceId' = source_id) IS TRUE),
  CHECK ((fact ->> 'sourceObservationId' = source_observation_id) IS TRUE),
  CHECK (source_delivery_ref IS NOT DISTINCT FROM (fact ->> 'sourceDeliveryRef')),
  CHECK ((fact ->> 'measurementKind' = measurement_kind) IS TRUE),
  CHECK (quality IS NOT DISTINCT FROM (fact -> 'quality')),
  CHECK ((jsonb_typeof(fact -> 'latitude') = 'number'
    AND (fact ->> 'latitude')::double precision = latitude) IS TRUE),
  CHECK ((jsonb_typeof(fact -> 'longitude') = 'number'
    AND (fact ->> 'longitude')::double precision = longitude) IS TRUE),
  CHECK ((jsonb_typeof(fact -> 'observedAt') = 'string'
    AND (EXTRACT(EPOCH FROM (fact ->> 'observedAt')::timestamptz) * 1000)::bigint = observed_at_ms) IS TRUE),
  CHECK ((jsonb_typeof(fact -> 'ingestedAt') = 'string'
    AND (EXTRACT(EPOCH FROM (fact ->> 'ingestedAt')::timestamptz) * 1000)::bigint = ingested_at_ms) IS TRUE),
  CHECK (icao24_hint IS NULL OR icao24_hint ~ '^[0-9A-F]{6}$')
);

CREATE INDEX position_observations_icao24_time
  ON tracking.position_observations (icao24_hint, observed_at_ms, source_id, source_observation_id)
  WHERE icao24_hint IS NOT NULL;
CREATE INDEX position_observations_position_gist
  ON tracking.position_observations USING gist (position);
CREATE INDEX position_observations_time_key
  ON tracking.position_observations (observed_at_ms, source_id, source_observation_id);

CREATE TABLE tracking.position_observation_outbox (
  event_id text PRIMARY KEY CHECK (event_id ~ '^evt_[A-Za-z0-9-]{1,100}$'),
  event_type text NOT NULL CHECK (event_type = 'tracking.position-observation-recorded.v1'),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  source_id text NOT NULL,
  source_observation_id text NOT NULL,
  occurred_at_ms bigint NOT NULL CHECK (occurred_at_ms BETWEEN 0 AND 9007199254740991),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  UNIQUE (source_id, source_observation_id, event_type),
  FOREIGN KEY (source_id, source_observation_id)
    REFERENCES tracking.position_observations (source_id, source_observation_id),
  CHECK ((payload ->> 'eventType' = event_type) IS TRUE),
  CHECK ((payload ->> 'sourceId' = source_id) IS TRUE),
  CHECK ((payload ->> 'sourceObservationId' = source_observation_id) IS TRUE),
  CHECK ((jsonb_typeof(payload -> 'occurredAtMs') = 'number'
    AND (payload ->> 'occurredAtMs')::numeric = occurred_at_ms) IS TRUE),
  CHECK (jsonb_typeof(payload -> 'observation') = 'object')
);
CREATE INDEX position_observation_outbox_recorded
  ON tracking.position_observation_outbox (recorded_at, event_id);

GRANT USAGE ON SCHEMA tracking TO tv_runtime;
GRANT SELECT, INSERT ON tracking.position_observations TO tv_runtime;
GRANT SELECT, INSERT ON tracking.position_observation_outbox TO tv_runtime;
RESET ROLE;
