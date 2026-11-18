-- Airframes Tracker v2: a PostgreSQL design excerpt, not a complete migration set.
-- Not executed against PostgreSQL in this iteration; integration tests are required.
-- The application assigns UUIDs; source/account scopes are explicit.

CREATE SCHEMA IF NOT EXISTS correlation;
CREATE SCHEMA IF NOT EXISTS availability;
CREATE SCHEMA IF NOT EXISTS event_delivery;
CREATE SCHEMA IF NOT EXISTS map_read;

-- In production, the outbox belongs to the transactional owner of the data.
-- One table illustrates the pattern here; owner_context does not authorize other modules
-- to perform arbitrary INSERTs. Narrower ports/roles are required.
CREATE TABLE event_delivery.outbox (
    event_id uuid PRIMARY KEY,
    owner_context text NOT NULL,
    event_type text NOT NULL,
    schema_version integer NOT NULL CHECK (schema_version > 0),
    stream_key text NOT NULL,
    stream_revision bigint NOT NULL CHECK (stream_revision > 0),
    occurred_at timestamptz NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    causation_id uuid,
    trace_id text NOT NULL,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    fanout_completed_at timestamptz,
    UNIQUE (owner_context, stream_key, stream_revision, event_type)
);
CREATE INDEX outbox_waiting_for_fanout
    ON event_delivery.outbox (recorded_at, event_id)
    WHERE fanout_completed_at IS NULL;

-- Fan-out is durable. An outbox published_at field does not replace consumer state.
CREATE TABLE event_delivery.deliveries (
    consumer_id text NOT NULL,
    event_id uuid NOT NULL REFERENCES event_delivery.outbox(event_id),
    state text NOT NULL DEFAULT 'READY'
        CHECK (state IN ('READY', 'LEASED', 'DONE', 'QUARANTINED')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    lease_token uuid,
    lease_until timestamptz,
    last_failure_code text,
    completed_at timestamptz,
    PRIMARY KEY (consumer_id, event_id),
    CHECK ((state = 'LEASED') = (lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX due_delivery_work
    ON event_delivery.deliveries (consumer_id, next_attempt_at, event_id)
    WHERE state = 'READY';
CREATE INDEX expired_delivery_leases
    ON event_delivery.deliveries (lease_until)
    WHERE state = 'LEASED';

-- Logical ownership: entries for a given consumer_id are managed only by
-- that consumer's transaction. A separate table can be materialized per context.
CREATE TABLE event_delivery.consumer_inbox (
    consumer_id text NOT NULL,
    event_id uuid NOT NULL,
    payload_digest text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (consumer_id, event_id)
);

CREATE TABLE correlation.aircraft_link_revisions (
    message_id uuid NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    message_revision bigint NOT NULL CHECK (message_revision > 0),
    status text NOT NULL CHECK (status IN ('MATCHED','UNMATCHED','AMBIGUOUS','CONFLICTED')),
    aircraft_id uuid,
    evidence jsonb NOT NULL,
    candidate_index_revision text NOT NULL,
    policy_version text NOT NULL,
    decided_at timestamptz NOT NULL,
    PRIMARY KEY (message_id, revision),
    CHECK ((status = 'MATCHED') = (aircraft_id IS NOT NULL))
);
CREATE TABLE correlation.aircraft_link_heads (
    message_id uuid PRIMARY KEY,
    revision bigint NOT NULL CHECK (revision > 0),
    FOREIGN KEY (message_id, revision)
        REFERENCES correlation.aircraft_link_revisions(message_id, revision)
        DEFERRABLE INITIALLY DEFERRED
);

-- A contribution within a visibility scope represents full state and can become a tombstone.
-- It contains the authoritative publication/contribution revision, not an arbitrary
-- maximum of two independent numbers (assignment and publication).
CREATE TABLE availability.message_contributions (
    visibility_scope text NOT NULL,
    message_id uuid NOT NULL,
    contribution_revision bigint NOT NULL CHECK (contribution_revision > 0),
    state text NOT NULL CHECK (state IN ('ASSIGNED','RETRACTED')),
    aircraft_id uuid,
    flight_session_id uuid,
    bearer text,
    observed_at timestamptz,
    message_revision bigint,
    assignment_revision bigint,
    publication_policy_version text NOT NULL,
    payload_digest text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (visibility_scope, message_id),
    CHECK (
      (state = 'ASSIGNED' AND aircraft_id IS NOT NULL
        AND observed_at IS NOT NULL AND bearer IS NOT NULL)
      OR
      (state = 'RETRACTED' AND aircraft_id IS NULL
        AND flight_session_id IS NULL AND observed_at IS NULL AND bearer IS NULL)
    )
);
CREATE INDEX availability_latest_eligible
    ON availability.message_contributions
    (visibility_scope, aircraft_id, observed_at DESC, message_id)
    WHERE state = 'ASSIGNED';
CREATE INDEX availability_latest_by_bearer
    ON availability.message_contributions
    (visibility_scope, aircraft_id, bearer, observed_at DESC, message_id)
    WHERE state = 'ASSIGNED';

CREATE TABLE availability.aircraft_state (
    visibility_scope text NOT NULL,
    aircraft_id uuid NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    freshness text NOT NULL CHECK (freshness IN ('RECENT','STALE','NONE')),
    last_message_id uuid,
    last_observed_at timestamptz,
    calculated_at timestamptz NOT NULL,
    next_transition_at timestamptz,
    policy_version text NOT NULL,
    PRIMARY KEY (visibility_scope, aircraft_id),
    CHECK ((last_message_id IS NULL) = (last_observed_at IS NULL))
);

-- Deadlines are durable and include a revision. Stale work may legitimately be a no-op.
CREATE TABLE availability.expiry_jobs (
    job_id uuid PRIMARY KEY,
    visibility_scope text NOT NULL,
    aircraft_id uuid NOT NULL,
    expected_revision bigint NOT NULL CHECK (expected_revision > 0),
    due_at timestamptz NOT NULL,
    finished_at timestamptz,
    UNIQUE (visibility_scope, aircraft_id, expected_revision)
);
CREATE INDEX pending_expiry_jobs ON availability.expiry_jobs(due_at, job_id)
    WHERE finished_at IS NULL;

-- The projection log counter is updated under a row lock; sequence numbers
-- commit in order for a given scope/shard/generation.
CREATE TABLE map_read.stream_heads (
    visibility_scope text NOT NULL,
    shard_id text NOT NULL,
    generation uuid NOT NULL,
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    PRIMARY KEY (visibility_scope, shard_id, generation)
);
CREATE TABLE map_read.change_log (
    visibility_scope text NOT NULL,
    shard_id text NOT NULL,
    generation uuid NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'array'),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (visibility_scope, shard_id, generation, revision),
    FOREIGN KEY (visibility_scope, shard_id, generation)
        REFERENCES map_read.stream_heads(visibility_scope, shard_id, generation)
);

-- DDL for positions, frames, reassembly, grants, roles and the complete application is intentionally omitted.
-- This file illustrates invariants on the critical path for changes, corrections and delivery.
