// Package tracking implements durable position ingest and bounded track reads.
package tracking

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/flight"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

var ErrObservationConflict = errors.New("source observation ID reused with different data")

const (
	DefaultHistoryLimit  = 500
	MaxHistoryLimit      = 5000
	MaxTrackGap          = 15 * time.Minute
	MaxPlausibleSpeedMPS = 1200.0
)

type IngestRequest struct {
	AircraftID  shared.AircraftID
	FlightID    shared.Optional[shared.FlightID]
	Observation flight.PositionObservation
	QualityRank int
	ReceivedAt  time.Time
}

type StoredObservation struct {
	AircraftID  shared.AircraftID                `bson:"aircraft_id" json:"aircraft_id"`
	FlightID    shared.Optional[shared.FlightID] `bson:"flight_id,omitempty" json:"flight_id,omitempty"`
	Observation flight.PositionObservation       `bson:"observation" json:"observation"`
	QualityRank int                              `bson:"quality_rank" json:"quality_rank"`
	ReceivedAt  time.Time                        `bson:"received_at" json:"received_at"`
}

type CurrentPosition struct {
	StoredObservation
	Version int64 `bson:"version" json:"version"`
}

type Viewport struct{ MinLatitude, MinLongitude, MaxLatitude, MaxLongitude float64 }

type TrackPoint struct {
	StoredObservation
	Segment int `json:"segment"`
}

type GeoJSONGeometry struct {
	Type        string `json:"type" bson:"type"`
	Coordinates any    `json:"coordinates" bson:"coordinates"`
}

type TrackSegment struct {
	Index    int             `json:"index"`
	Points   []TrackPoint    `json:"points"`
	Geometry GeoJSONGeometry `json:"geometry"`
}

type TrackPage struct {
	FlightID   shared.FlightID `json:"flight_id"`
	Segments   []TrackSegment  `json:"segments"`
	NextBefore time.Time       `json:"next_before,omitempty"`
	Truncated  bool            `json:"truncated"`
}

// Repository stores each source observation immutably and applies an atomic,
// monotonic current-position projection. Track queries return event-time order.
type Repository interface {
	InsertObservation(context.Context, StoredObservation) (bool, error)
	ApplyCurrent(context.Context, StoredObservation) (CurrentPosition, bool, error)
	ListFlightPositions(context.Context, shared.FlightID, time.Time, time.Time, *Viewport, int) ([]StoredObservation, bool, error)
}

type Service struct {
	repository Repository
	now        func() time.Time
}

func NewService(repository Repository) *Service {
	return &Service{repository: repository, now: func() time.Time { return time.Now().UTC() }}
}

// Ingest deduplicates by the true source identity and advances current state
// only when the event-time/quality/source ordering says the candidate is newer.
// The bool is true only when a newly stored observation also became current.
func (s *Service) Ingest(ctx context.Context, req IngestRequest) (CurrentPosition, bool, error) {
	if _, err := shared.NewAircraftID(string(req.AircraftID)); err != nil {
		return CurrentPosition{}, false, err
	}
	if req.FlightID.Valid {
		if _, err := shared.NewFlightID(string(req.FlightID.Value)); err != nil {
			return CurrentPosition{}, false, err
		}
	}
	obs, err := flight.NewPositionObservation(req.Observation)
	if err != nil {
		return CurrentPosition{}, false, err
	}
	if req.QualityRank < 0 || req.QualityRank > 100 {
		return CurrentPosition{}, false, shared.NewDomainError(shared.ErrOutOfRange, "quality rank must be between 0 and 100")
	}
	if req.ReceivedAt.IsZero() {
		req.ReceivedAt = s.now()
	}
	item := StoredObservation{AircraftID: req.AircraftID, FlightID: req.FlightID, Observation: obs, QualityRank: req.QualityRank, ReceivedAt: req.ReceivedAt.UTC()}
	inserted, err := s.repository.InsertObservation(ctx, item)
	if errors.Is(err, ErrObservationConflict) {
		return CurrentPosition{}, false, err
	}
	if err != nil {
		return CurrentPosition{}, false, fmt.Errorf("store position observation: %w", err)
	}
	current, advanced, err := s.repository.ApplyCurrent(ctx, item)
	if err != nil {
		return CurrentPosition{}, false, fmt.Errorf("update current position: %w", err)
	}
	return current, inserted && advanced, nil
}

// Current reads the last accepted event-time position for an aircraft.
func (s *Service) Current(ctx context.Context, aircraft shared.AircraftID) (CurrentPosition, error) {
	if _, err := shared.NewAircraftID(string(aircraft)); err != nil {
		return CurrentPosition{}, err
	}
	return s.repositoryCurrent(ctx, aircraft)
}

type currentReader interface {
	GetCurrent(context.Context, shared.AircraftID) (CurrentPosition, error)
}

func (s *Service) repositoryCurrent(ctx context.Context, aircraft shared.AircraftID) (CurrentPosition, error) {
	r, ok := s.repository.(currentReader)
	if !ok {
		return CurrentPosition{}, errors.New("repository does not support current-position reads")
	}
	return r.GetCurrent(ctx, aircraft)
}

// FlightTrack returns bounded observed points only. Invalid or ambiguous
// viewport boxes are rejected instead of silently returning surprising data.
func (s *Service) FlightTrack(ctx context.Context, id shared.FlightID, from, to time.Time, viewport *Viewport, limit int) (TrackPage, error) {
	if _, err := shared.NewFlightID(string(id)); err != nil {
		return TrackPage{}, err
	}
	if from.IsZero() || to.IsZero() || to.Before(from) {
		return TrackPage{}, shared.NewDomainError(shared.ErrInvalidInput, "track time range must be valid")
	}
	if viewport != nil {
		if math.IsNaN(viewport.MinLatitude) || math.IsNaN(viewport.MaxLatitude) || math.IsNaN(viewport.MinLongitude) || math.IsNaN(viewport.MaxLongitude) || viewport.MinLatitude < -90 || viewport.MaxLatitude > 90 || viewport.MinLatitude >= viewport.MaxLatitude || viewport.MinLongitude < -180 || viewport.MaxLongitude > 180 || viewport.MinLongitude >= viewport.MaxLongitude {
			return TrackPage{}, shared.NewDomainError(shared.ErrOutOfRange, "viewport must be an ordered WGS84 box without antimeridian crossing")
		}
	}
	if limit <= 0 {
		limit = DefaultHistoryLimit
	}
	if limit > MaxHistoryLimit {
		limit = MaxHistoryLimit
	}
	items, more, err := s.repository.ListFlightPositions(ctx, id, from.UTC(), to.UTC(), viewport, limit+1)
	if err != nil {
		return TrackPage{}, err
	}
	if len(items) > limit {
		items = items[:limit]
		more = true
	}
	page := TrackPage{FlightID: id, Segments: []TrackSegment{}, Truncated: more}
	var segments []TrackSegment
	for _, item := range items {
		p := item.Observation
		newSegment := len(segments) == 0
		if !newSegment {
			last := segments[len(segments)-1].Points[len(segments[len(segments)-1].Points)-1]
			dt := p.ObservedAt.Time.Sub(last.Observation.ObservedAt.Time)
			newSegment = dt > MaxTrackGap || dt < 0 || distanceM(last.Observation.Latitude, last.Observation.Longitude, p.Latitude, p.Longitude)/math.Max(dt.Seconds(), 1) > MaxPlausibleSpeedMPS
		}
		if newSegment {
			segments = append(segments, TrackSegment{Index: len(segments), Points: []TrackPoint{}})
		}
		segments[len(segments)-1].Points = append(segments[len(segments)-1].Points, TrackPoint{StoredObservation: item, Segment: len(segments) - 1})
	}
	for i := range segments {
		coords := make([][]float64, 0, len(segments[i].Points))
		for _, p := range segments[i].Points {
			coords = append(coords, []float64{p.Observation.Longitude, p.Observation.Latitude})
		}
		if len(coords) == 1 {
			segments[i].Geometry = GeoJSONGeometry{Type: "Point", Coordinates: coords[0]}
		} else {
			segments[i].Geometry = GeoJSONGeometry{Type: "LineString", Coordinates: coords}
		}
	}
	page.Segments = segments
	if more && len(items) > 0 {
		page.NextBefore = items[len(items)-1].Observation.ObservedAt.Time
	}
	return page, nil
}

func distanceM(lat1, lon1, lat2, lon2 float64) float64 {
	const r = 6371000
	rad := math.Pi / 180
	dlat := (lat2 - lat1) * rad
	dlon := (lon2 - lon1) * rad
	a := math.Sin(dlat/2)*math.Sin(dlat/2) + math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dlon/2)*math.Sin(dlon/2)
	return 2 * r * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}
