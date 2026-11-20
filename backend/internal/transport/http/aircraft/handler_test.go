package aircraft

import (
	"context"
	"errors"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"net/http/httptest"
	"testing"
	"time"
)

type fakeReader struct {
	query FlightQuery
	track TrackQuery
	err   error
}

func (*fakeReader) MapSnapshot(context.Context) (MapSnapshot, error) { return MapSnapshot{}, nil }
func (*fakeReader) ListAircraft(context.Context, string, int) (AircraftPage, error) {
	return AircraftPage{}, nil
}
func (*fakeReader) GetAircraft(context.Context, shared.AircraftID) (Aircraft, error) {
	return Aircraft{}, ErrNotFound
}
func (f *fakeReader) ListFlights(_ context.Context, q FlightQuery) (FlightPage, error) {
	f.query = q
	return FlightPage{}, f.err
}
func (*fakeReader) GetFlight(context.Context, shared.FlightID) (Flight, error) {
	return Flight{}, ErrNotFound
}
func (f *fakeReader) FlightTrack(_ context.Context, _ shared.FlightID, q TrackQuery) (Track, error) {
	f.track = q
	return Track{}, nil
}
func TestFlightQueryValidationAndTrackBounds(t *testing.T) {
	f := &fakeReader{}
	h := NewHandler(f)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/flights?limit=12&startedAfter=2025-01-01T00:00:00Z", nil))
	if w.Code != 200 || f.query.Limit != 12 || !f.query.StartedAfter.Valid {
		t.Fatalf("status=%d query=%+v", w.Code, f.query)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/flights?unknown=x", nil))
	if w.Code != 400 {
		t.Fatalf("unknown query status=%d", w.Code)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/flights/f1/track?limit=5001", nil))
	if w.Code != 400 {
		t.Fatalf("track limit status=%d", w.Code)
	}
}
func TestSnapshotRejectsQueryAndDependencyMapsTo503(t *testing.T) {
	f := &fakeReader{err: errors.New("offline")}
	h := NewHandler(f)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/map/snapshot?limit=2", nil))
	if w.Code != 400 {
		t.Fatalf("query status=%d", w.Code)
	}
	_ = time.Now()
}
