-- Durable keyset cursor for bounded identity correction replay.
ALTER TABLE fleet_identity.replay_requests
  ADD COLUMN phase text NOT NULL DEFAULT 'POSITIONS' CHECK (phase IN ('POSITIONS','MESSAGES','DONE')),
  ADD COLUMN cursor_time_ms bigint,
  ADD COLUMN cursor_source_id text,
  ADD COLUMN cursor_observation_id text,
  ADD COLUMN cursor_message_id text,
  ADD COLUMN completed_at timestamptz;
CREATE INDEX replay_requests_pending ON fleet_identity.replay_requests (request_id)
  WHERE phase <> 'DONE';
CREATE INDEX message_identity_icao24_time ON source_ingestion.message_revisions
  ((canonical #>> '{aircraftHints,icao24}'),
   ((canonical #>> '{observation,observedAt,at}')::bigint), message_id);
CREATE INDEX message_identity_registration_time ON source_ingestion.message_revisions
  ((canonical #>> '{aircraftHints,registration}'),
   ((canonical #>> '{observation,observedAt,at}')::bigint), message_id);
GRANT UPDATE (phase,cursor_time_ms,cursor_source_id,cursor_observation_id,cursor_message_id,completed_at)
  ON fleet_identity.replay_requests TO tv_runtime;
