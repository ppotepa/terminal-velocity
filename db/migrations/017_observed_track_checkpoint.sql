-- Track pages reject cursors after any private position projection change.
ALTER TABLE tracking.current_position_state
  ADD COLUMN revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0);
GRANT UPDATE (revision) ON tracking.current_position_state TO tv_runtime;

CREATE INDEX current_position_candidates_track ON tracking.current_position_candidates
  (aircraft_id, observed_at_ms, source_id COLLATE "C", observation_id);
