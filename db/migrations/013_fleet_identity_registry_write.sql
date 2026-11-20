-- All runtime assertion writes must atomically advance the directory revision
-- and enqueue correction work. Historical direct grants are removed forward.
REVOKE INSERT ON fleet_identity.assertions, fleet_identity.replay_expansions FROM tv_runtime;
REVOKE UPDATE (revision) ON fleet_identity.registry_state FROM tv_runtime;
-- Preserve row-lock capability for decision transactions without allowing a
-- runtime writer to change the revision value.
GRANT UPDATE (singleton) ON fleet_identity.registry_state TO tv_runtime;
REVOKE USAGE ON SEQUENCE fleet_identity.assertions_assertion_id_seq,
  fleet_identity.replay_expansions_expansion_id_seq FROM tv_runtime;

SET LOCAL ROLE tv_fleet_owner;
CREATE FUNCTION fleet_identity.append_assertion(
  p_aircraft_id text, p_kind text, p_normalized_alias text,
  p_valid_from_ms bigint, p_valid_until_ms bigint, p_source_id text,
  p_issuer text, p_supersedes_id bigint DEFAULT NULL
) RETURNS fleet_identity.assertions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE
  prior fleet_identity.assertions%ROWTYPE;
  inserted fleet_identity.assertions%ROWTYPE;
  next_revision bigint;
  affected fleet_identity.assertions%ROWTYPE;
BEGIN
  -- Serializing on this row also fences competing corrections and makes the
  -- revision visible only with the assertion and its replay work at commit.
  UPDATE fleet_identity.registry_state SET revision=revision+1
    WHERE singleton RETURNING revision INTO next_revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aircraft registry state is missing'; END IF;
  IF p_supersedes_id IS NOT NULL THEN
    SELECT * INTO prior FROM fleet_identity.assertions
      WHERE assertion_id=p_supersedes_id AND NOT EXISTS (
        SELECT 1 FROM fleet_identity.assertions successor
        WHERE successor.supersedes_id=p_supersedes_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'Superseded assertion is absent or already corrected'; END IF;
    IF prior.source_id <> p_source_id OR prior.issuer <> p_issuer THEN
      RAISE EXCEPTION 'Only the same source and issuer may correct an assertion';
    END IF;
  END IF;
  INSERT INTO fleet_identity.assertions
    (aircraft_id,kind,normalized_alias,valid_from_ms,valid_until_ms,source_id,issuer,revision,supersedes_id)
  VALUES (p_aircraft_id,p_kind,p_normalized_alias,p_valid_from_ms,p_valid_until_ms,
    p_source_id,p_issuer,next_revision,p_supersedes_id)
  RETURNING * INTO inserted;
  FOR affected IN SELECT * FROM fleet_identity.assertions
    WHERE assertion_id IN (inserted.assertion_id, p_supersedes_id)
    ORDER BY assertion_id
  LOOP
    INSERT INTO fleet_identity.replay_requests
      (assertion_id,kind,normalized_alias,valid_from_ms,valid_until_ms)
    VALUES (inserted.assertion_id,affected.kind,affected.normalized_alias,
      affected.valid_from_ms,affected.valid_until_ms);
    INSERT INTO fleet_identity.replay_expansions
      (assertion_id,aircraft_id,valid_from_ms,valid_until_ms)
    VALUES (inserted.assertion_id,affected.aircraft_id,
      affected.valid_from_ms,affected.valid_until_ms);
  END LOOP;
  RETURN inserted;
END $function$;
REVOKE ALL ON FUNCTION fleet_identity.append_assertion(text,text,text,bigint,bigint,text,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleet_identity.append_assertion(text,text,text,bigint,bigint,text,text,bigint) TO tv_runtime;
RESET ROLE;
