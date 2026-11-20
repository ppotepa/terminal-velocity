package geography

import (
	"testing"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

func ring(points ...GeoPoint) []GeoPoint { return points }

func point(lat, lon float64) GeoPoint { return GeoPoint{Latitude: lat, Longitude: lon} }

func observation(lat, lon float64, seconds int, uncertainty time.Duration) Observation {
	at, _ := shared.NewObservationTime(time.Date(2025, 1, 1, 0, 0, seconds, 0, time.UTC), time.Second, uncertainty)
	return Observation{Point: point(lat, lon), At: at}
}

func TestPolygonAndHoleContainment(t *testing.T) {
	area, err := NewPolygonArea("de-main", ring(point(0, 0), point(0, 10), point(10, 10), point(10, 0), point(0, 0)), [][]GeoPoint{ring(point(3, 3), point(7, 3), point(7, 7), point(3, 7), point(3, 3))})
	if err != nil {
		t.Fatal(err)
	}
	if MatchArea(area, shared.Some(point(1, 1))) != SpatialInside {
		t.Fatal("expected outer polygon point inside")
	}
	if MatchArea(area, shared.Some(point(5, 5))) != SpatialOutside {
		t.Fatal("expected hole point outside")
	}
	if MatchArea(area, shared.None[GeoPoint]()) != SpatialUnknown {
		t.Fatal("missing point should be unknown")
	}
}

func TestAntimeridianPolygonContainment(t *testing.T) {
	area, err := NewPolygonArea("dateline", ring(point(-10, 170), point(-10, -170), point(10, -170), point(10, 170), point(-10, 170)), nil)
	if err != nil {
		t.Fatal(err)
	}
	if MatchArea(area, shared.Some(point(0, 179))) != SpatialInside {
		t.Fatal("expected east dateline point inside")
	}
	if MatchArea(area, shared.Some(point(0, -179))) != SpatialInside {
		t.Fatal("expected west dateline point inside")
	}
	if MatchArea(area, shared.Some(point(0, 0))) != SpatialOutside {
		t.Fatal("expected Greenwich outside dateline polygon")
	}
}

func TestRadiusAndCorridorPredicates(t *testing.T) {
	radius, err := NewRadiusArea("home", point(0, 0), 2000)
	if err != nil {
		t.Fatal(err)
	}
	if MatchArea(radius, shared.Some(point(0, 0.01))) != SpatialInside {
		t.Fatal("nearby point should be inside radius")
	}
	if MatchArea(radius, shared.Some(point(0, 1))) != SpatialOutside {
		t.Fatal("distant point should be outside radius")
	}
	corridor, err := NewCorridorArea("route-corridor", []GeoPoint{point(0, 0), point(0, 1)}, 2000)
	if err != nil {
		t.Fatal(err)
	}
	if MatchArea(corridor, shared.Some(point(0.005, 0.5))) != SpatialInside {
		t.Fatal("nearby point should be inside corridor")
	}
	if MatchArea(corridor, shared.Some(point(1, 0.5))) != SpatialOutside {
		t.Fatal("distant point should be outside corridor")
	}
}

func TestCrossingClassificationDedupAndUncertainty(t *testing.T) {
	area, err := NewPolygonArea("box", ring(point(-1, -1), point(-1, 1), point(1, 1), point(1, -1), point(-1, -1)), nil)
	if err != nil {
		t.Fatal(err)
	}
	out := EvaluateCrossing(area, shared.Some(observation(0, 0, 0, 0)), shared.Some(observation(0, 2, 10, 0)), time.Minute)
	if out.Status != CrossingInferred || out.EventKey == "" || !out.At.Valid {
		t.Fatalf("expected inferred crossing with key and time: %+v", out)
	}
	boundary := EvaluateCrossing(area, shared.Some(observation(0, 2, 0, 0)), shared.Some(observation(0, 1, 10, 0)), time.Minute)
	if boundary.Status != CrossingObserved {
		t.Fatalf("sampled boundary should be observed: %+v", boundary)
	}
	uncertain := EvaluateCrossing(area, shared.Some(observation(0, 0, 0, time.Second)), shared.Some(observation(0, 2, 10, 0)), time.Minute)
	if uncertain.Status != CrossingUnknown {
		t.Fatalf("uncertain observation time should remain unknown: %+v", uncertain)
	}
	missing := EvaluateCrossing(area, shared.None[Observation](), shared.Some(observation(0, 2, 10, 0)), time.Minute)
	if missing.Status != CrossingUnknown {
		t.Fatalf("missing point should remain unknown: %+v", missing)
	}
	gap := EvaluateCrossing(area, shared.Some(observation(0, 0, 0, 0)), shared.Some(observation(0, 2, 600, 0)), time.Minute)
	if gap.Status != CrossingUnknown {
		t.Fatalf("long gap should not confirm crossing: %+v", gap)
	}
	datelineJump := EvaluateCrossing(area, shared.Some(observation(0, 179, 0, 0)), shared.Some(observation(0, -179, 10, 0)), time.Minute)
	if datelineJump.Status != CrossingUnknown {
		t.Fatalf("dateline discontinuity should remain unknown: %+v", datelineJump)
	}
}

func TestCountryCodeAndInvalidArea(t *testing.T) {
	if code, err := NewCountryCode("de"); err != nil || code != "DE" {
		t.Fatalf("country code normalization: %q %v", code, err)
	}
	if _, err := NewCountryCode("D3"); err == nil {
		t.Fatal("accepted invalid country code")
	}
	if _, err := NewPolygonArea("open", ring(point(0, 0), point(0, 1), point(1, 1), point(1, 0)), nil); err == nil {
		t.Fatal("accepted unclosed ring")
	}
}
