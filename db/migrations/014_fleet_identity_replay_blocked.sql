-- An incomplete candidate set pauses only its request until the registry changes.
ALTER TABLE fleet_identity.replay_requests
  DROP CONSTRAINT replay_requests_phase_check;
ALTER TABLE fleet_identity.replay_requests
  ADD CONSTRAINT replay_requests_phase_check
    CHECK (phase IN ('POSITIONS','MESSAGES','DONE','BLOCKED')),
  ADD COLUMN blocked_revision bigint CHECK (blocked_revision >= 0);
GRANT UPDATE (blocked_revision) ON fleet_identity.replay_requests TO tv_runtime;
