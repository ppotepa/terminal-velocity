package geography

import (
	"testing"
	"time"

	core "github.com/ppotepa/terminal-velocity/backend/internal/core/geography"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

func syntheticService(t *testing.T) *Service {
	t.Helper()
	ring := []core.GeoPoint{{Latitude: 0, Longitude: 0}, {Latitude: 0, Longitude: 1}, {Latitude: 1, Longitude: 1}, {Latitude: 1, Longitude: 0}, {Latitude: 0, Longitude: 0}}
	area, err := core.NewPolygonArea("AA-main", ring, nil)
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewService(Dataset{Version: "fixture-1", Source: "synthetic test fixture", License: "test-only", Countries: []CountryBoundary{{Code: "AA", Name: "Alpha", Areas: []core.GeoArea{area}}}}, 10*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	return service
}
func observation(t *testing.T, lon, lat float64, sec int64) shared.Optional[core.Observation] {
	t.Helper()
	p, err := core.NewGeoPoint(lat, lon)
	if err != nil {
		t.Fatal(err)
	}
	return shared.Some(core.Observation{Point: p, At: shared.ObservationTime{Time: time.Unix(sec, 0).UTC()}})
}

func TestEntryEventsInferEntryOnceAndMarkBoundaryObservation(t *testing.T) {
	s := syntheticService(t)
	track := []shared.Optional[core.Observation]{observation(t, -.1, .5, 0), observation(t, .2, .5, 60), observation(t, .7, .5, 120)}
	events := s.EntryEvents("aircraft1", shared.Some(shared.FlightID("flight1")), track)
	if len(events) != 1 || events[0].Country != "AA" || events[0].Evidence.Status != core.CrossingInferred || events[0].Evidence.ToInside != true || events[0].Evidence.At.Value.Time.Unix() != 30 {
		t.Fatalf("events=%+v", events)
	}
	boundary := s.EntryEvents("aircraft1", shared.None[shared.FlightID](), []shared.Optional[core.Observation]{observation(t, -.1, .5, 0), observation(t, 0, .5, 20)})
	if len(boundary) != 1 || boundary[0].Evidence.Status != core.CrossingObserved || boundary[0].Evidence.Reason != "boundary_position_observed" {
		t.Fatalf("boundary event=%+v", boundary)
	}
}

func TestLongGapAndMissingPositionAreUnknownNotPositive(t *testing.T) {
	s := syntheticService(t)
	longGap := s.EntryEvents("aircraft1", shared.None[shared.FlightID](), []shared.Optional[core.Observation]{observation(t, -.1, .5, 0), observation(t, .5, .5, 3600)})
	if len(longGap) != 1 || longGap[0].Evidence.Status != core.CrossingUnknown || longGap[0].Evidence.Reason != "track_gap_too_long" {
		t.Fatalf("long-gap event=%+v", longGap)
	}
	missing := s.EntryEvents("aircraft1", shared.None[shared.FlightID](), []shared.Optional[core.Observation]{shared.None[core.Observation](), observation(t, .5, .5, 60)})
	if len(missing) != 1 || missing[0].Evidence.Status != core.CrossingUnknown {
		t.Fatalf("missing-position event=%+v", missing)
	}
}

func TestPresenceAndBBoxRadiusCorridorCountryFilters(t *testing.T) {
	s := syntheticService(t)
	inside := core.Observation{Point: core.GeoPoint{Latitude: .5, Longitude: .5}, At: shared.ObservationTime{Time: time.Unix(1, 0)}}
	outside := core.Observation{Point: core.GeoPoint{Latitude: 2, Longitude: 2}, At: shared.ObservationTime{Time: time.Unix(2, 0)}}
	presence := s.CountriesAt(shared.Some(inside.Point))
	if len(presence) != 1 || presence[0].Code != "AA" || presence[0].Match != core.SpatialInside {
		t.Fatalf("presence=%+v", presence)
	}
	bbox := BoundingBox{MinLatitude: 0, MinLongitude: 0, MaxLatitude: 1, MaxLongitude: 1}
	area, err := core.NewRadiusArea("r", core.GeoPoint{Latitude: .5, Longitude: .5}, 1000)
	if err != nil {
		t.Fatal(err)
	}
	corridor, err := core.NewCorridorArea("c", []core.GeoPoint{{Latitude: .5, Longitude: 0}, {Latitude: .5, Longitude: 1}}, 1000)
	if err != nil {
		t.Fatal(err)
	}
	for _, filter := range []PositionFilter{{BBox: &bbox}, {Area: &area}, {Area: &corridor}, {Countries: []core.CountryCode{"AA"}}} {
		got, err := s.FilterPositions([]core.Observation{inside, outside}, filter)
		if err != nil || len(got) != 1 || got[0].Point != inside.Point {
			t.Fatalf("filter=%+v result=%+v err=%v", filter, got, err)
		}
	}
	unknown, err := s.FilterPositions([]core.Observation{inside}, PositionFilter{Countries: []core.CountryCode{"BB"}})
	if err != nil || len(unknown) != 0 {
		t.Fatalf("unknown-country filter=%+v err=%v", unknown, err)
	}
}

func TestDatelineCountryPresenceAndDiscontinuousEntryUnknown(t *testing.T) {
	ring := []core.GeoPoint{{Latitude: -1, Longitude: 179}, {Latitude: -1, Longitude: -179}, {Latitude: 1, Longitude: -179}, {Latitude: 1, Longitude: 179}, {Latitude: -1, Longitude: 179}}
	area, err := core.NewPolygonArea("DL-main", ring, nil)
	if err != nil {
		t.Fatal(err)
	}
	s, err := NewService(Dataset{Version: "fixture-1", Source: "synthetic", License: "fixture", Countries: []CountryBoundary{{Code: "DL", Name: "Dateline", Areas: []core.GeoArea{area}}}}, 10*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	for _, lon := range []float64{179.5, -179.5} {
		if got := s.CountriesAt(shared.Some(core.GeoPoint{Latitude: 0, Longitude: lon})); len(got) != 1 {
			t.Fatalf("longitude %v presence=%+v", lon, got)
		}
	}
	events := s.EntryEvents("aircraft1", shared.None[shared.FlightID](), []shared.Optional[core.Observation]{observation(t, 179.5, 0, 0), observation(t, -179.5, 0, 60)})
	if len(events) != 0 {
		t.Fatalf("already-inside dateline positions must not create entry: %+v", events)
	}
	events = s.EntryEvents("aircraft1", shared.None[shared.FlightID](), []shared.Optional[core.Observation]{observation(t, 170, 0, 0), observation(t, -179.5, 0, 60)})
	if len(events) != 1 || events[0].Evidence.Status != core.CrossingUnknown || events[0].Evidence.Reason != "antimeridian_discontinuity" {
		t.Fatalf("dateline event=%+v", events)
	}
}

func TestInvalidDatasetFailsClosed(t *testing.T) {
	if _, err := NewService(Dataset{Version: "x", Source: "x", License: "x", Countries: []CountryBoundary{{Code: "AA", Name: "bad", Areas: []core.GeoArea{{ID: "bad", Kind: core.AreaPolygon}}}}}, time.Minute); err == nil {
		t.Fatal("invalid country polygon accepted")
	}
}
