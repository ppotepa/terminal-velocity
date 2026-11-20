package tracking

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/flight"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

type memoryRepository struct {
	observations map[string]StoredObservation
	current      map[string]CurrentPosition
}

func newMemoryRepository() *memoryRepository {
	return &memoryRepository{observations: map[string]StoredObservation{}, current: map[string]CurrentPosition{}}
}
func identity(p flight.PositionObservation) string {
	return string(p.Source) + ":" + p.SourceObservationID
}
func (m *memoryRepository) InsertObservation(_ context.Context, v StoredObservation) (bool, error) {
	key := identity(v.Observation)
	if old, ok := m.observations[key]; ok {
		if !sameObservation(old, v) {
			return false, ErrObservationConflict
		}
		return false, nil
	}
	m.observations[key] = v
	return true, nil
}
func sameObservation(a, b StoredObservation) bool {
	return a.AircraftID == b.AircraftID && a.FlightID == b.FlightID && a.Observation.ObservedAt == b.Observation.ObservedAt && a.Observation.Latitude == b.Observation.Latitude && a.Observation.Longitude == b.Observation.Longitude
}
func (m *memoryRepository) ApplyCurrent(_ context.Context, v StoredObservation) (CurrentPosition, bool, error) {
	old, ok := m.current[string(v.AircraftID)]
	if ok && compareStored(v, old.StoredObservation) <= 0 {
		return old, false, nil
	}
	version := old.Version + 1
	if !ok {
		version = 1
	}
	cur := CurrentPosition{StoredObservation: v, Version: version}
	m.current[string(v.AircraftID)] = cur
	return cur, true, nil
}

func compareStored(a, b StoredObservation) int {
	if a.Observation.ObservedAt.Time.After(b.Observation.ObservedAt.Time) {
		return 1
	}
	if a.Observation.ObservedAt.Time.Before(b.Observation.ObservedAt.Time) {
		return -1
	}
	if a.QualityRank > b.QualityRank {
		return 1
	}
	if a.QualityRank < b.QualityRank {
		return -1
	}
	return 0
}
func (m *memoryRepository) GetCurrent(_ context.Context, id shared.AircraftID) (CurrentPosition, error) {
	v, ok := m.current[string(id)]
	if !ok {
		return CurrentPosition{}, errors.New("missing")
	}
	return v, nil
}
func (m *memoryRepository) ListFlightPositions(_ context.Context, id shared.FlightID, from, to time.Time, vp *Viewport, limit int) ([]StoredObservation, bool, error) {
	out := []StoredObservation{}
	for _, v := range m.observations {
		if !v.FlightID.Valid || v.FlightID.Value != id || v.Observation.ObservedAt.Time.Before(from) || v.Observation.ObservedAt.Time.After(to) {
			continue
		}
		if vp != nil && (v.Observation.Latitude < vp.MinLatitude || v.Observation.Latitude > vp.MaxLatitude || v.Observation.Longitude < vp.MinLongitude || v.Observation.Longitude > vp.MaxLongitude) {
			continue
		}
		out = append(out, v)
	}
	sortStored(out)
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	return out, more, nil
}
func sortStored(v []StoredObservation) {
	for i := 1; i < len(v); i++ {
		for j := i; j > 0 && v[j].Observation.ObservedAt.Time.Before(v[j-1].Observation.ObservedAt.Time); j-- {
			v[j], v[j-1] = v[j-1], v[j]
		}
	}
}

func testRequest(sec int, id string, lat, lon float64) IngestRequest {
	return IngestRequest{AircraftID: "abc123", FlightID: shared.Some(shared.FlightID("flight1")), Observation: flight.PositionObservation{SourceObservationID: id, Source: "fixture", ObservedAt: shared.ObservationTime{Time: time.Unix(int64(sec), 0)}, Latitude: lat, Longitude: lon}, QualityRank: 50}
}

func TestIngestDeduplicatesAndNeverRegressesCurrent(t *testing.T) {
	repo := newMemoryRepository()
	svc := NewService(repo)
	ctx := context.Background()
	req := testRequest(10, "p10", 51, 7)
	if _, accepted, err := svc.Ingest(ctx, req); err != nil || !accepted {
		t.Fatalf("first ingest accepted=%v err=%v", accepted, err)
	}
	if _, accepted, err := svc.Ingest(ctx, req); err != nil || accepted {
		t.Fatalf("duplicate accepted=%v err=%v", accepted, err)
	}
	late := testRequest(5, "p5", 50, 6)
	if _, accepted, err := svc.Ingest(ctx, late); err != nil || accepted {
		t.Fatalf("late ingest accepted=%v err=%v", accepted, err)
	}
	current, err := svc.Current(ctx, "abc123")
	if err != nil || current.Observation.SourceObservationID != "p10" || current.Version != 1 {
		t.Fatalf("current=%+v err=%v", current, err)
	}
	conflict := req
	conflict.Observation.Latitude = 52
	if _, _, err := svc.Ingest(ctx, conflict); !errors.Is(err, ErrObservationConflict) {
		t.Fatalf("conflict err=%v", err)
	}
}

func TestFlightTrackSplitsGapsAndImplausibleJumpsAndBounds(t *testing.T) {
	repo := newMemoryRepository()
	svc := NewService(repo)
	ctx := context.Background()
	for _, r := range []IngestRequest{testRequest(0, "a", 51, 7), testRequest(10, "b", 51.01, 7.01), testRequest(20, "c", 52, 8), testRequest(2000, "d", 52.001, 8.001)} {
		if _, _, err := svc.Ingest(ctx, r); err != nil {
			t.Fatal(err)
		}
	}
	page, err := svc.FlightTrack(ctx, "flight1", time.Unix(0, 0), time.Unix(3000, 0), nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Segments) != 3 || page.Segments[0].Geometry.Type != "LineString" || page.Segments[1].Geometry.Type != "Point" || page.Segments[0].Geometry.Coordinates.([][]float64)[0][0] != 7 {
		t.Fatalf("track segments=%+v", page.Segments)
	}
	page, err = svc.FlightTrack(ctx, "flight1", time.Unix(0, 0), time.Unix(3000, 0), nil, 2)
	if err != nil || !page.Truncated || len(page.Segments) > 2 {
		t.Fatalf("bounded page=%+v err=%v", page, err)
	}
}

func TestPositionWithoutRecognizedFlightIsNotAddedToTrack(t *testing.T) {
	repo := newMemoryRepository()
	svc := NewService(repo)
	req := testRequest(0, "x", 51, 7)
	req.FlightID = shared.None[shared.FlightID]()
	if _, _, err := svc.Ingest(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	page, err := svc.FlightTrack(context.Background(), "flight1", time.Unix(0, 0), time.Unix(10, 0), nil, 10)
	if err != nil || len(page.Segments) != 0 {
		t.Fatalf("track=%+v err=%v", page, err)
	}
}
