-- Fair scheduling across new position jobs, alias expansion and replay requests.
-- A prior deployed scheduler used only JOBS and CORRECTIONS; the new work
-- class allows bounded progress for corrections under a continuous expansion feed.
ALTER TABLE fleet_identity.replay_scheduler
  DROP CONSTRAINT replay_scheduler_next_kind_check;
ALTER TABLE fleet_identity.replay_scheduler
  ADD CONSTRAINT replay_scheduler_next_kind_check
    CHECK (next_kind IN ('JOBS', 'EXPANSIONS', 'CORRECTIONS'));
