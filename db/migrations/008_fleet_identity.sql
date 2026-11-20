-- Internal aircraft registry and append-only temporal identity decisions.
DO $fleet_role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tv_fleet_owner') THEN
    BEGIN
      CREATE ROLE tv_fleet_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tv_fleet_owner'
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Role tv_fleet_owner has incompatible privileges';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
    WHERE r.rolname='tv_fleet_owner') THEN
    RAISE EXCEPTION 'Role tv_fleet_owner has unexpected inherited role membership';
  END IF;
END $fleet_role$;
CREATE SCHEMA fleet_identity AUTHORIZATION tv_fleet_owner;
REVOKE ALL ON SCHEMA fleet_identity FROM PUBLIC;
GRANT USAGE ON SCHEMA tracking TO tv_fleet_owner;
GRANT REFERENCES ON tracking.position_observations TO tv_fleet_owner;
SET LOCAL ROLE tv_fleet_owner;

CREATE TABLE fleet_identity.aircraft (
  aircraft_id text PRIMARY KEY CHECK (aircraft_id ~ '^ac_[a-zA-Z0-9-]{1,64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE fleet_identity.registry_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO fleet_identity.registry_state (singleton) VALUES (true);

CREATE TABLE fleet_identity.assertions (
  assertion_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aircraft_id text NOT NULL REFERENCES fleet_identity.aircraft (aircraft_id),
  kind text NOT NULL CHECK (kind IN ('ICAO24','REGISTRATION')),
  normalized_alias text NOT NULL CHECK (
    (kind='ICAO24' AND normalized_alias ~ '^[0-9A-F]{6}$') OR
    (kind='REGISTRATION' AND normalized_alias ~ '^[A-Z0-9][A-Z0-9-]{2,11}$')),
  valid_from_ms bigint NOT NULL CHECK (valid_from_ms BETWEEN 0 AND 9007199254740991),
  valid_until_ms bigint CHECK (valid_until_ms > valid_from_ms AND valid_until_ms <= 9007199254740991),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  source_id text NOT NULL CHECK (source_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  issuer text NOT NULL CHECK (issuer ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  revision bigint NOT NULL UNIQUE CHECK (revision > 0),
  supersedes_id bigint UNIQUE REFERENCES fleet_identity.assertions (assertion_id),
  CHECK (supersedes_id IS NULL OR supersedes_id <> assertion_id)
);
CREATE INDEX assertions_alias_time ON fleet_identity.assertions
  (kind, normalized_alias, valid_from_ms, valid_until_ms);
CREATE INDEX assertions_aircraft ON fleet_identity.assertions (aircraft_id, revision);

-- A new assertion or correction schedules a bounded, explicit replay range.
CREATE TABLE fleet_identity.replay_requests (
  request_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assertion_id bigint NOT NULL REFERENCES fleet_identity.assertions (assertion_id),
  kind text NOT NULL CHECK (kind IN ('ICAO24','REGISTRATION')),
  normalized_alias text NOT NULL,
  valid_from_ms bigint NOT NULL,
  valid_until_ms bigint,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE fleet_identity.position_link_revisions (
  source_id text NOT NULL,
  source_observation_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  registry_revision bigint NOT NULL CHECK (registry_revision >= 0),
  status text NOT NULL CHECK (status IN ('MATCHED','AMBIGUOUS','CONFLICTED','UNMATCHED','INCOMPLETE')),
  aircraft_id text REFERENCES fleet_identity.aircraft (aircraft_id),
  candidate_ids text[] NOT NULL DEFAULT '{}',
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_id, source_observation_id, revision),
  FOREIGN KEY (source_id,source_observation_id) REFERENCES tracking.position_observations (source_id,source_observation_id),
  CHECK ((status='MATCHED') = (aircraft_id IS NOT NULL))
);
CREATE TABLE fleet_identity.position_link_heads (
  source_id text NOT NULL,
  source_observation_id text NOT NULL,
  revision bigint NOT NULL,
  PRIMARY KEY (source_id,source_observation_id),
  FOREIGN KEY (source_id,source_observation_id,revision)
    REFERENCES fleet_identity.position_link_revisions (source_id,source_observation_id,revision)
);
CREATE INDEX position_link_aircraft ON fleet_identity.position_link_revisions (aircraft_id, revision)
  WHERE aircraft_id IS NOT NULL;

GRANT USAGE ON SCHEMA fleet_identity TO tv_runtime;
GRANT SELECT, INSERT ON fleet_identity.aircraft, fleet_identity.assertions,
  fleet_identity.replay_requests, fleet_identity.position_link_revisions,
  fleet_identity.position_link_heads TO tv_runtime;
GRANT SELECT, UPDATE (revision) ON fleet_identity.registry_state TO tv_runtime;
GRANT UPDATE (revision) ON fleet_identity.position_link_heads TO tv_runtime;
GRANT USAGE ON SEQUENCE fleet_identity.assertions_assertion_id_seq TO tv_runtime;
GRANT USAGE ON SEQUENCE fleet_identity.replay_requests_request_id_seq TO tv_runtime;
RESET ROLE;
