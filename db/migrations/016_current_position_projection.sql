-- Private current-position read model. Identity decisions enqueue projection work
-- in the transaction that changes a link head; consumers acknowledge separately.
GRANT USAGE ON SCHEMA fleet_identity TO tv_tracking_owner;
GRANT REFERENCES ON fleet_identity.position_link_revisions TO tv_tracking_owner;
SET LOCAL ROLE tv_tracking_owner;

CREATE TABLE tracking.current_position_jobs (
  job_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id text NOT NULL,
  source_observation_id text NOT NULL,
  link_revision bigint NOT NULL CHECK (link_revision > 0),
  completed_at timestamptz,
  UNIQUE (source_id, source_observation_id, link_revision),
  FOREIGN KEY (source_id, source_observation_id, link_revision)
    REFERENCES fleet_identity.position_link_revisions
      (source_id, source_observation_id, revision)
);
CREATE INDEX current_position_jobs_pending ON tracking.current_position_jobs (job_id)
  WHERE completed_at IS NULL;

CREATE TABLE tracking.current_position_inbox (
  job_id bigint PRIMARY KEY REFERENCES tracking.current_position_jobs (job_id),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE tracking.current_position_candidates (
  source_id text NOT NULL,
  source_observation_id text NOT NULL,
  observation_id uuid NOT NULL,
  aircraft_id text NOT NULL,
  link_revision bigint NOT NULL CHECK (link_revision > 0),
  observed_at_ms bigint NOT NULL CHECK (observed_at_ms BETWEEN 0 AND 9007199254740991),
  nic bigint,
  nac_p bigint,
  containment_radius_m double precision,
  measurement_rank smallint NOT NULL CHECK (measurement_rank BETWEEN 1 AND 3),
  source_priority integer NOT NULL,
  PRIMARY KEY (source_id, source_observation_id),
  FOREIGN KEY (source_id,source_observation_id)
    REFERENCES tracking.position_observations (source_id,source_observation_id)
);
CREATE INDEX current_position_candidates_best ON tracking.current_position_candidates
  (aircraft_id, observed_at_ms DESC, nic DESC NULLS LAST, nac_p DESC NULLS LAST,
   containment_radius_m ASC NULLS LAST, measurement_rank DESC, source_priority DESC,
   source_id COLLATE "C", observation_id);

CREATE TABLE tracking.current_position_heads (
  aircraft_id text PRIMARY KEY,
  revision bigint NOT NULL CHECK (revision > 0),
  source_id text,
  source_observation_id text,
  calculated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((source_id IS NULL) = (source_observation_id IS NULL)),
  FOREIGN KEY (source_id,source_observation_id)
    REFERENCES tracking.position_observations (source_id,source_observation_id)
);

CREATE TABLE tracking.current_position_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton)
);
INSERT INTO tracking.current_position_state (singleton) VALUES (true);

CREATE TABLE tracking.current_position_backfill_progress (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_source_id text,
  last_source_observation_id text,
  completed_at timestamptz,
  CHECK ((last_source_id IS NULL) = (last_source_observation_id IS NULL))
);
INSERT INTO tracking.current_position_backfill_progress (singleton) VALUES (true);

CREATE FUNCTION tracking.enqueue_current_position() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
BEGIN
  INSERT INTO tracking.current_position_jobs (source_id,source_observation_id,link_revision)
    VALUES (NEW.source_id,NEW.source_observation_id,NEW.revision)
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION tracking.enqueue_current_position() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tracking.enqueue_current_position() TO tv_fleet_owner;

GRANT SELECT, INSERT, UPDATE (completed_at) ON tracking.current_position_jobs TO tv_runtime;
GRANT USAGE ON SEQUENCE tracking.current_position_jobs_job_id_seq TO tv_runtime;
GRANT SELECT, INSERT ON tracking.current_position_inbox TO tv_runtime;
GRANT SELECT, INSERT, DELETE ON tracking.current_position_candidates TO tv_runtime;
GRANT UPDATE (observation_id,aircraft_id,link_revision,observed_at_ms,nic,nac_p,containment_radius_m,
  measurement_rank,source_priority) ON tracking.current_position_candidates TO tv_runtime;
GRANT SELECT, INSERT ON tracking.current_position_heads TO tv_runtime;
GRANT UPDATE (revision,source_id,source_observation_id,calculated_at)
  ON tracking.current_position_heads TO tv_runtime;
GRANT SELECT, UPDATE (singleton) ON tracking.current_position_state TO tv_runtime;
GRANT SELECT, UPDATE (last_source_id,last_source_observation_id,completed_at)
  ON tracking.current_position_backfill_progress TO tv_runtime;
RESET ROLE;

GRANT TRIGGER ON fleet_identity.position_link_heads TO tv_tracking_owner;
SET LOCAL ROLE tv_tracking_owner;
CREATE TRIGGER enqueue_current_position_after_insert
AFTER INSERT OR UPDATE OF revision ON fleet_identity.position_link_heads
FOR EACH ROW EXECUTE FUNCTION tracking.enqueue_current_position();
RESET ROLE;
