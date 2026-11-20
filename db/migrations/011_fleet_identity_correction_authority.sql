-- A correction may only retire a claim from the same source and issuer.
-- Keep this invariant in the database for all writers, including future adapters.
SET LOCAL ROLE tv_fleet_owner;

DO $check_existing$
BEGIN
  IF EXISTS (
    SELECT 1 FROM fleet_identity.assertions successor
    JOIN fleet_identity.assertions prior ON prior.assertion_id=successor.supersedes_id
    WHERE successor.source_id <> prior.source_id OR successor.issuer <> prior.issuer
  ) THEN
    RAISE EXCEPTION 'Existing cross-authority aircraft assertion correction requires review';
  END IF;
END $check_existing$;

CREATE FUNCTION fleet_identity.enforce_correction_authority() RETURNS trigger
LANGUAGE plpgsql AS $function$
DECLARE
  prior_source text;
  prior_issuer text;
BEGIN
  IF NEW.supersedes_id IS NOT NULL THEN
    SELECT source_id, issuer INTO prior_source, prior_issuer
    FROM fleet_identity.assertions WHERE assertion_id=NEW.supersedes_id;
    IF FOUND AND (NEW.source_id <> prior_source OR NEW.issuer <> prior_issuer) THEN
      RAISE EXCEPTION 'Only the same source and issuer may correct an assertion'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE TRIGGER enforce_correction_authority BEFORE INSERT ON fleet_identity.assertions
FOR EACH ROW EXECUTE FUNCTION fleet_identity.enforce_correction_authority();

RESET ROLE;
