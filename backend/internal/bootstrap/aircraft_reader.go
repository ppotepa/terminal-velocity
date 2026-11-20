package bootstrap

import (
	"context"
	"errors"
	"time"

	trackingapp "github.com/ppotepa/terminal-velocity/backend/internal/application/tracking"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/flight"
	shared "github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	httpaircraft "github.com/ppotepa/terminal-velocity/backend/internal/transport/http/aircraft"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
)

type aircraftReader struct{ tracking *trackingapp.Service }

func (r aircraftReader) MapSnapshot(context.Context) (httpaircraft.MapSnapshot, error) {
	return httpaircraft.MapSnapshot{GeneratedAt: time.Now().UTC(), SourceFreshness: "unknown", Aircraft: []httpaircraft.MapAircraft{}}, nil
}
func (r aircraftReader) ListAircraft(context.Context, string, int) (httpaircraft.AircraftPage, error) {
	return httpaircraft.AircraftPage{Items: []httpaircraft.Aircraft{}, NextCursor: nil}, nil
}
func (r aircraftReader) GetAircraft(ctx context.Context, id shared.AircraftID) (httpaircraft.Aircraft, error) {
	current, err := r.tracking.Current(ctx, id)
	if errors.Is(err, driver.ErrNoDocuments) {
		return httpaircraft.Aircraft{}, httpaircraft.ErrNotFound
	}
	if err != nil {
		return httpaircraft.Aircraft{}, err
	}
	position := toHTTPPosition(current.Observation)
	return httpaircraft.Aircraft{ID: string(id), Identifiers: []httpaircraft.IdentifierAssertion{}, CurrentPosition: &position}, nil
}
func (r aircraftReader) ListFlights(context.Context, httpaircraft.FlightQuery) (httpaircraft.FlightPage, error) {
	return httpaircraft.FlightPage{Items: []httpaircraft.Flight{}, NextCursor: nil}, nil
}
func (r aircraftReader) GetFlight(context.Context, shared.FlightID) (httpaircraft.Flight, error) {
	return httpaircraft.Flight{}, httpaircraft.ErrNotFound
}
func (r aircraftReader) FlightTrack(ctx context.Context, id shared.FlightID, q httpaircraft.TrackQuery) (httpaircraft.Track, error) {
	from, to := time.Now().UTC().Add(-365*24*time.Hour), time.Now().UTC().Add(time.Minute)
	if q.From.Valid {
		from = q.From.Value
	}
	if q.To.Valid {
		to = q.To.Value
	}
	page, err := r.tracking.FlightTrack(ctx, id, from, to, nil, q.Limit)
	if err != nil {
		return httpaircraft.Track{}, err
	}
	segments := make([][]httpaircraft.Position, 0, len(page.Segments))
	for _, segment := range page.Segments {
		points := make([]httpaircraft.Position, 0, len(segment.Points))
		for _, point := range segment.Points {
			points = append(points, toHTTPPosition(point.Observation))
		}
		segments = append(segments, points)
	}
	return httpaircraft.Track{FlightID: string(id), Segments: segments, Truncated: page.Truncated}, nil
}
func toHTTPPosition(p flight.PositionObservation) httpaircraft.Position {
	source := string(p.Source)
	observed := p.ObservedAt.Time.UTC()
	position := httpaircraft.Position{Latitude: p.Latitude, Longitude: p.Longitude, ObservedAt: observed, Source: source}
	if p.AltitudeMeters.Valid {
		position.AltitudeMeters = evidenceValue(p.AltitudeMeters.Value, source, observed, p.ObservedAt.Uncertainty.Seconds())
	}
	if p.GroundSpeedMPS.Valid {
		position.GroundSpeedMPS = evidenceValue(p.GroundSpeedMPS.Value, source, observed, p.ObservedAt.Uncertainty.Seconds())
	}
	if p.HeadingDegrees.Valid {
		position.HeadingDegrees = evidenceValue(p.HeadingDegrees.Value, source, observed, p.ObservedAt.Uncertainty.Seconds())
	}
	return position
}
func evidenceValue(value any, source string, observed time.Time, uncertainty float64) *httpaircraft.EvidenceValue {
	return &httpaircraft.EvidenceValue{Value: value, Certainty: "observed", Source: &source, ObservedAt: &observed, UncertaintySeconds: &uncertainty}
}
