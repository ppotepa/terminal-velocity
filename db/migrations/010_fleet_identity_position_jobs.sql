-- Every new immutable position fact schedules a durable identity decision.
GRANT TRIGGER ON tracking.position_observations TO tv_fleet_owner;
GRANT SELECT (source_id, source_observation_id) ON tracking.position_observations TO tv_fleet_owner;
SET LOCAL ROLE tv_fleet_owner;

CREATE TABLE fleet_identity.position_link_jobs (
  job_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id text NOT NULL,
  source_observation_id text NOT NULL,
  completed_at timestamptz,
  UNIQUE (source_id, source_observation_id),
  FOREIGN KEY (source_id, source_observation_id)
    REFERENCES tracking.position_observations (source_id, source_observation_id)
);
CREATE INDEX position_link_jobs_pending ON fleet_identity.position_link_jobs (job_id)
  WHERE completed_at IS NULL;

-- Serialize the choice of work class, so a continuous position feed cannot
-- postpone correction replay indefinitely (and vice versa).
CREATE TABLE fleet_identity.replay_scheduler (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  next_kind text NOT NULL CHECK (next_kind IN ('JOBS', 'CORRECTIONS'))
);
INSERT INTO fleet_identity.replay_scheduler (singleton, next_kind) VALUES (true, 'JOBS');

CREATE FUNCTION fleet_identity.enqueue_position_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO fleet_identity.position_link_jobs (source_id, source_observation_id)
    VALUES (NEW.source_id, NEW.source_observation_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER enqueue_position_link AFTER INSERT ON tracking.position_observations
  FOR EACH ROW EXECUTE FUNCTION fleet_identity.enqueue_position_link();

-- Existing facts are queued by the explicit, bounded position backfill command.
-- Its cursor is committed with each batch and survives process restarts.
CREATE TABLE fleet_identity.position_backfill_progress (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_source_id text,
  last_source_observation_id text,
  completed_at timestamptz,
  CHECK ((last_source_id IS NULL) = (last_source_observation_id IS NULL))
);
INSERT INTO fleet_identity.position_backfill_progress (singleton) VALUES (true);

GRANT SELECT ON fleet_identity.position_link_jobs TO tv_runtime;
GRANT UPDATE (completed_at) ON fleet_identity.position_link_jobs TO tv_runtime;
GRANT SELECT, UPDATE (next_kind) ON fleet_identity.replay_scheduler TO tv_runtime;
RESET ROLE;
