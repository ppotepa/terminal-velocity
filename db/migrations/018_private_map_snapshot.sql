-- Private, compact map rows. Both triggers run in the transaction that changes
-- their source projection, so a read sees one committed position/status version.
GRANT USAGE ON SCHEMA availability TO tv_tracking_owner;
GRANT SELECT, TRIGGER ON availability.contributions TO tv_tracking_owner;
SET LOCAL ROLE tv_tracking_owner;

CREATE TABLE tracking.map_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO tracking.map_state (singleton) VALUES (true);

CREATE TABLE tracking.map_aircraft_positions (
  aircraft_id text PRIMARY KEY,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  position point GENERATED ALWAYS AS (point(longitude, latitude)) STORED,
  observed_at_ms bigint NOT NULL CHECK (observed_at_ms BETWEEN 0 AND 9007199254740991),
  source_id text NOT NULL,
  measurement_kind text NOT NULL CHECK (measurement_kind IN ('ADS_B','MLAT','OTHER')),
  timestamp_precision text NOT NULL CHECK (timestamp_precision IN ('MILLISECOND','SECOND','MINUTE','HOUR','UNKNOWN')),
  timestamp_uncertainty_ms bigint,
  CHECK (timestamp_uncertainty_ms IS NULL OR timestamp_uncertainty_ms >= 0)
);
CREATE INDEX map_aircraft_positions_gist ON tracking.map_aircraft_positions USING gist (position);

CREATE TABLE tracking.map_demo_message_status (
  aircraft_id text NOT NULL,
  bearer text NOT NULL CHECK (bearer IN ('VHF_ACARS','VDL2','HFDL','SATCOM')),
  last_observed_at_ms bigint NOT NULL CHECK (last_observed_at_ms BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (aircraft_id, bearer)
);

CREATE FUNCTION tracking.refresh_map_position() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE selected record;
BEGIN
  SELECT p.latitude,p.longitude,p.observed_at_ms,p.source_id,p.measurement_kind,
    p.fact ->> 'timestampPrecision' AS timestamp_precision,
    (p.fact ->> 'timestampUncertaintyMs')::bigint AS timestamp_uncertainty_ms
    INTO selected FROM tracking.position_observations p
    WHERE p.source_id=NEW.source_id AND p.source_observation_id=NEW.source_observation_id;
  IF NOT FOUND THEN
    DELETE FROM tracking.map_aircraft_positions WHERE aircraft_id=NEW.aircraft_id;
  ELSE
    INSERT INTO tracking.map_aircraft_positions
      (aircraft_id,latitude,longitude,observed_at_ms,source_id,measurement_kind,
       timestamp_precision,timestamp_uncertainty_ms)
      VALUES (NEW.aircraft_id,selected.latitude,selected.longitude,selected.observed_at_ms,
        selected.source_id,selected.measurement_kind,selected.timestamp_precision,
        selected.timestamp_uncertainty_ms)
      ON CONFLICT (aircraft_id) DO UPDATE SET latitude=EXCLUDED.latitude,
        longitude=EXCLUDED.longitude,observed_at_ms=EXCLUDED.observed_at_ms,
        source_id=EXCLUDED.source_id,measurement_kind=EXCLUDED.measurement_kind,
        timestamp_precision=EXCLUDED.timestamp_precision,
        timestamp_uncertainty_ms=EXCLUDED.timestamp_uncertainty_ms;
  END IF;
  UPDATE tracking.map_state SET revision=revision+1 WHERE singleton;
  RETURN NEW;
END $function$;

CREATE FUNCTION tracking.refresh_map_demo_status(affected_aircraft text, affected_bearer text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE latest bigint;
BEGIN
  IF affected_aircraft IS NULL OR affected_bearer IS NULL THEN RETURN; END IF;
  -- Serialize competing corrections for the same aircraft/protocol before
  -- reading max(), including when distinct message rows are being changed.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(affected_aircraft || ':' || affected_bearer, 0));
  SELECT max(observed_at_ms) INTO latest FROM availability.contributions
    WHERE aircraft_id=affected_aircraft AND bearer=affected_bearer;
  IF latest IS NULL THEN
    DELETE FROM tracking.map_demo_message_status
      WHERE aircraft_id=affected_aircraft AND bearer=affected_bearer;
  ELSE
    INSERT INTO tracking.map_demo_message_status (aircraft_id,bearer,last_observed_at_ms)
      VALUES (affected_aircraft,affected_bearer,latest)
      ON CONFLICT (aircraft_id,bearer) DO UPDATE
        SET last_observed_at_ms=EXCLUDED.last_observed_at_ms;
  END IF;
END $function$;

CREATE FUNCTION tracking.on_demo_contribution_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE old_aircraft text; old_bearer text; new_aircraft text; new_bearer text;
  affected record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_aircraft := OLD.aircraft_id; old_bearer := OLD.bearer;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_aircraft := NEW.aircraft_id; new_bearer := NEW.bearer;
  END IF;
  FOR affected IN SELECT DISTINCT aircraft_id,bearer FROM
    (VALUES (old_aircraft,old_bearer),(new_aircraft,new_bearer)) AS changed(aircraft_id,bearer)
    WHERE aircraft_id IS NOT NULL AND bearer IS NOT NULL
    ORDER BY aircraft_id,bearer LOOP
    PERFORM tracking.refresh_map_demo_status(affected.aircraft_id,affected.bearer);
  END LOOP;
  UPDATE tracking.map_state SET revision=revision+1 WHERE singleton;
  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION tracking.refresh_map_position() FROM PUBLIC;
REVOKE ALL ON FUNCTION tracking.refresh_map_demo_status(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tracking.on_demo_contribution_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tracking.refresh_map_position() TO tv_runtime;
GRANT EXECUTE ON FUNCTION tracking.on_demo_contribution_change() TO tv_availability_owner;
GRANT SELECT ON tracking.map_state,tracking.map_aircraft_positions,
  tracking.map_demo_message_status TO tv_runtime;
GRANT UPDATE (revision) ON tracking.map_state TO tv_runtime;
RESET ROLE;

GRANT TRIGGER ON tracking.current_position_heads TO tv_tracking_owner;
SET LOCAL ROLE tv_tracking_owner;
CREATE TRIGGER map_position_after_head_change
AFTER INSERT OR UPDATE OF revision ON tracking.current_position_heads
FOR EACH ROW EXECUTE FUNCTION tracking.refresh_map_position();
CREATE TRIGGER map_demo_status_after_contribution_change
AFTER INSERT OR UPDATE OR DELETE ON availability.contributions
FOR EACH ROW EXECUTE FUNCTION tracking.on_demo_contribution_change();
RESET ROLE;

-- Existing heads and contributions are backfilled once at migration time.
-- This is a small local prototype; large production backfills need a later
-- bounded operational migration before allowing a public map.
INSERT INTO tracking.map_aircraft_positions
  (aircraft_id,latitude,longitude,observed_at_ms,source_id,measurement_kind,
   timestamp_precision,timestamp_uncertainty_ms)
SELECT h.aircraft_id,p.latitude,p.longitude,p.observed_at_ms,p.source_id,p.measurement_kind,
  p.fact ->> 'timestampPrecision',(p.fact ->> 'timestampUncertaintyMs')::bigint
FROM tracking.current_position_heads h JOIN tracking.position_observations p
  ON p.source_id=h.source_id AND p.source_observation_id=h.source_observation_id;
INSERT INTO tracking.map_demo_message_status (aircraft_id,bearer,last_observed_at_ms)
SELECT aircraft_id,bearer,max(observed_at_ms) FROM availability.contributions
  WHERE aircraft_id IS NOT NULL GROUP BY aircraft_id,bearer;
