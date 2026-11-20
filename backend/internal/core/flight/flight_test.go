package flight

import (
	"encoding/json"
	"math"
	"testing"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

func observed(seconds int) shared.ObservationTime {
	at, _ := shared.NewObservationTime(time.Date(2025, 1, 1, 0, 0, seconds, 0, time.FixedZone("feed", 3600)), time.Second, 0)
	return at
}

func position(id string, seconds int, lat, lon float64) PositionObservation {
	return PositionObservation{SourceObservationID: id, Source: "adsb-test", ObservedAt: observed(seconds), Latitude: lat, Longitude: lon}
}

func TestPositionValidationEnforcesWGS84AndPhysicalUnits(t *testing.T) {
	valid := position("pos-1", 0, -90, 180)
	if _, err := NewPositionObservation(valid); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []PositionObservation{position("pos-2", 0, 90.1, 10), position("pos-3", 0, 10, -180.1), position("pos-4", 0, math.NaN(), 2)} {
		if _, err := NewPositionObservation(invalid); err == nil {
			t.Errorf("accepted invalid coordinates: %+v", invalid)
		}
	}
	invalidSpeed := valid
	invalidSpeed.GroundSpeedMPS = shared.Some(-1.0)
	if _, err := NewPositionObservation(invalidSpeed); err == nil {
		t.Fatal("accepted negative ground speed")
	}
	invalidHeading := valid
	invalidHeading.HeadingDegrees = shared.Some(360.0)
	if _, err := NewPositionObservation(invalidHeading); err == nil {
		t.Fatal("accepted heading outside [0,360)")
	}
}

func TestTrackAppendDeduplicatesSegmentsGapsAndOutOfOrder(t *testing.T) {
	var track Track
	if outcome, err := track.Append(position("p0", 0, 51, 7), 10*time.Second); err != nil || outcome != AppendAdded {
		t.Fatalf("first append: %v, %v", outcome, err)
	}
	if outcome, err := track.Append(position("p1", 4, 51.1, 7.1), 10*time.Second); err != nil || outcome != AppendAdded {
		t.Fatalf("second append: %v, %v", outcome, err)
	}
	if outcome, err := track.Append(position("p1", 4, 51.1, 7.1), 10*time.Second); err != nil || outcome != AppendDuplicate {
		t.Fatalf("duplicate append: %v, %v", outcome, err)
	}
	if outcome, err := track.Append(position("p2", 30, 52, 8), 10*time.Second); err != nil || outcome != AppendAdded {
		t.Fatalf("gap append: %v, %v", outcome, err)
	}
	if len(track.Segments) != 2 || len(track.Segments[0].Points) != 2 || len(track.Segments[1].Points) != 1 {
		t.Fatalf("gap was not retained: %+v", track)
	}
	if _, err := track.Append(position("p3", 20, 52, 8), 10*time.Second); err == nil {
		t.Fatal("accepted out-of-order point")
	}
	changed := position("p0", 0, 1, 1)
	if _, err := track.Append(changed, 10*time.Second); err == nil {
		t.Fatal("accepted reused observation identity with conflicting data")
	}
}

func TestTrackSerializationContainsObservedPointsAndGaps(t *testing.T) {
	var track Track
	_, _ = track.Append(position("p0", 0, 51, 7), 5*time.Second)
	_, _ = track.Append(position("p1", 20, 52, 8), 5*time.Second)
	encoded, err := json.Marshal(track)
	if err != nil {
		t.Fatal(err)
	}
	var decoded Track
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.Segments) != 2 || len(decoded.Segments[0].Points) != 1 || len(decoded.Segments[1].Points) != 1 {
		t.Fatalf("serialization lost observed gap: %s", encoded)
	}
	if decoded.Segments[1].Points[0].Latitude != 52 {
		t.Fatalf("serialized point changed: %+v", decoded)
	}
}

func TestFlightMayHaveUnknownEndpoints(t *testing.T) {
	flight, err := NewFlight("flight-1", shared.None[shared.AircraftID](), shared.None[shared.Callsign]())
	if err != nil {
		t.Fatal(err)
	}
	if flight.Origin.Valid || flight.Destination.Valid {
		t.Fatal("unknown endpoints should remain absent")
	}
	if err := flight.Track.Validate(); err != nil {
		t.Fatalf("empty observed track is valid: %v", err)
	}
}

func TestEndpointAssertionRequiresProvenanceAndAirportCode(t *testing.T) {
	at := observed(0)
	e := shared.Evidence{Source: "schedule", ObservedAt: at}
	if _, err := NewEndpointAssertion("EDDF", e); err != nil {
		t.Fatal(err)
	}
	if _, err := NewEndpointAssertion("not-an-airport", e); err == nil {
		t.Fatal("accepted malformed airport code")
	}
}
