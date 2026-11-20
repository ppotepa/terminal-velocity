-- Append transactions record at most two expansion tasks. Workers expand each
-- aircraft's overlapping aliases by keyset cursor in separate bounded pages.
SET LOCAL ROLE tv_fleet_owner;
CREATE TABLE fleet_identity.replay_expansions (
  expansion_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assertion_id bigint NOT NULL REFERENCES fleet_identity.assertions (assertion_id),
  aircraft_id text NOT NULL REFERENCES fleet_identity.aircraft (aircraft_id),
  valid_from_ms bigint NOT NULL CHECK (valid_from_ms BETWEEN 0 AND 9007199254740991),
  valid_until_ms bigint CHECK (valid_until_ms > valid_from_ms AND valid_until_ms <= 9007199254740991),
  cursor_assertion_id bigint NOT NULL DEFAULT 0 CHECK (cursor_assertion_id >= 0),
  completed_at timestamptz
);
CREATE INDEX replay_expansions_pending ON fleet_identity.replay_expansions (expansion_id)
  WHERE completed_at IS NULL;
CREATE INDEX assertions_aircraft_keyset ON fleet_identity.assertions (aircraft_id, assertion_id);
GRANT SELECT, INSERT ON fleet_identity.replay_expansions TO tv_runtime;
GRANT UPDATE (cursor_assertion_id, completed_at) ON fleet_identity.replay_expansions TO tv_runtime;
GRANT USAGE ON SEQUENCE fleet_identity.replay_expansions_expansion_id_seq TO tv_runtime;
RESET ROLE;
