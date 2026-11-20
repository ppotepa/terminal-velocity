// Package flight models observed flight activity. It contains no planned-route
// or interpolation model; track segments contain source-observed positions only.
package flight

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

type PositionObservation struct {
	SourceObservationID string                   `json:"source_observation_id"`
	Source              shared.SourceID          `json:"source"`
	ObservedAt          shared.ObservationTime   `json:"observed_at"`
	Latitude            float64                  `json:"latitude"`
	Longitude           float64                  `json:"longitude"`
	AltitudeMeters      shared.Optional[float64] `json:"altitude_meters,omitempty"`
	GroundSpeedMPS      shared.Optional[float64] `json:"ground_speed_mps,omitempty"`
	HeadingDegrees      shared.Optional[float64] `json:"heading_degrees,omitempty"`
}

func NewPositionObservation(p PositionObservation) (PositionObservation, error) {
	if _, err := shared.NewMessageID(p.SourceObservationID); err != nil {
		return PositionObservation{}, fmt.Errorf("source observation id: %w", err)
	}
	if _, err := shared.NewSourceID(string(p.Source)); err != nil {
		return PositionObservation{}, fmt.Errorf("position source: %w", err)
	}
	if p.ObservedAt.Time.IsZero() {
		return PositionObservation{}, shared.NewDomainError(shared.ErrInvalidInput, "position observation time is required")
	}
	if math.IsNaN(p.Latitude) || math.IsInf(p.Latitude, 0) || p.Latitude < -90 || p.Latitude > 90 {
		return PositionObservation{}, shared.NewDomainError(shared.ErrOutOfRange, "latitude must be finite and within [-90, 90]")
	}
	if math.IsNaN(p.Longitude) || math.IsInf(p.Longitude, 0) || p.Longitude < -180 || p.Longitude > 180 {
		return PositionObservation{}, shared.NewDomainError(shared.ErrOutOfRange, "longitude must be finite and within [-180, 180]")
	}
	if p.AltitudeMeters.Valid && !finite(p.AltitudeMeters.Value) {
		return PositionObservation{}, shared.NewDomainError(shared.ErrInvalidInput, "altitude must be finite")
	}
	if p.GroundSpeedMPS.Valid && (!finite(p.GroundSpeedMPS.Value) || p.GroundSpeedMPS.Value < 0) {
		return PositionObservation{}, shared.NewDomainError(shared.ErrOutOfRange, "ground speed must be finite and non-negative")
	}
	if p.HeadingDegrees.Valid && (!finite(p.HeadingDegrees.Value) || p.HeadingDegrees.Value < 0 || p.HeadingDegrees.Value >= 360) {
		return PositionObservation{}, shared.NewDomainError(shared.ErrOutOfRange, "heading must be in [0, 360)")
	}
	p.ObservedAt.Time = p.ObservedAt.Time.UTC()
	return p, nil
}

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

type EndpointAssertion struct {
	Code     string          `json:"code"`
	Evidence shared.Evidence `json:"evidence"`
}

func NewEndpointAssertion(code string, evidence shared.Evidence) (EndpointAssertion, error) {
	if len(code) != 3 && len(code) != 4 {
		return EndpointAssertion{}, shared.NewDomainError(shared.ErrInvalidInput, "airport endpoint code must be IATA or ICAO length")
	}
	for _, ch := range code {
		if ch < 'A' || ch > 'Z' {
			return EndpointAssertion{}, shared.NewDomainError(shared.ErrInvalidInput, "airport endpoint code must be uppercase ASCII letters")
		}
	}
	if err := evidence.Validate(); err != nil {
		return EndpointAssertion{}, err
	}
	return EndpointAssertion{Code: code, Evidence: evidence}, nil
}

type BoundaryEvidence struct {
	At     shared.ObservationTime `json:"at"`
	Source shared.SourceID        `json:"source"`
	Reason string                 `json:"reason"`
}

type Flight struct {
	ID          shared.FlightID                    `json:"id"`
	AircraftID  shared.Optional[shared.AircraftID] `json:"aircraft_id,omitempty"`
	Callsign    shared.Optional[shared.Callsign]   `json:"callsign,omitempty"`
	StartedAt   shared.Optional[BoundaryEvidence]  `json:"started_at,omitempty"`
	EndedAt     shared.Optional[BoundaryEvidence]  `json:"ended_at,omitempty"`
	Origin      shared.Optional[EndpointAssertion] `json:"origin,omitempty"`
	Destination shared.Optional[EndpointAssertion] `json:"destination,omitempty"`
	Track       Track                              `json:"track"`
}

func NewFlight(id shared.FlightID, aircraft shared.Optional[shared.AircraftID], callsign shared.Optional[shared.Callsign]) (Flight, error) {
	if _, err := shared.NewFlightID(string(id)); err != nil {
		return Flight{}, fmt.Errorf("flight id: %w", err)
	}
	if aircraft.Valid {
		if _, err := shared.NewAircraftID(string(aircraft.Value)); err != nil {
			return Flight{}, fmt.Errorf("aircraft id: %w", err)
		}
	}
	if callsign.Valid {
		if _, err := shared.NewCallsign(string(callsign.Value)); err != nil {
			return Flight{}, fmt.Errorf("callsign: %w", err)
		}
	}
	return Flight{ID: id, AircraftID: aircraft, Callsign: callsign, Track: Track{Segments: []TrackSegment{}}}, nil
}

type TrackSegment struct {
	Points []PositionObservation `json:"points"`
}

type Track struct {
	Segments []TrackSegment `json:"segments"`
}

type AppendOutcome string

const (
	AppendAdded      AppendOutcome = "added"
	AppendDuplicate  AppendOutcome = "duplicate"
	AppendOutOfOrder AppendOutcome = "out_of_order"
)

// Append adds one observed position. Duplicate source identities are
// idempotent. Equal-time points with different identities are ordered by source
// and observation ID. A gap exceeding maxGap starts a new segment; no synthetic
// points are created. Out-of-order observations are rejected for explicit
// replay/rebuild by a caller.
func (t *Track) Append(input PositionObservation, maxGap time.Duration) (AppendOutcome, error) {
	if err := t.Validate(); err != nil {
		return "", err
	}
	p, err := NewPositionObservation(input)
	if err != nil {
		return "", err
	}
	if maxGap <= 0 {
		return "", shared.NewDomainError(shared.ErrInvalidInput, "maximum track gap must be positive")
	}
	for _, segment := range t.Segments {
		for _, current := range segment.Points {
			if current.Source == p.Source && current.SourceObservationID == p.SourceObservationID {
				if samePosition(current, p) {
					return AppendDuplicate, nil
				}
				return "", shared.NewDomainError(shared.ErrConflict, "source observation ID was reused with different position data")
			}
		}
	}
	if len(t.Segments) > 0 {
		lastSegment := &t.Segments[len(t.Segments)-1]
		last := lastSegment.Points[len(lastSegment.Points)-1]
		if p.ObservedAt.Time.Before(last.ObservedAt.Time) {
			return AppendOutOfOrder, shared.NewDomainError(shared.ErrOutOfRange, "out-of-order position must be replayed into a rebuilt track")
		}
		if p.ObservedAt.Time.Sub(last.ObservedAt.Time) > maxGap {
			t.Segments = append(t.Segments, TrackSegment{Points: []PositionObservation{p}})
			return AppendAdded, nil
		}
		lastSegment.Points = append(lastSegment.Points, p)
		sort.SliceStable(lastSegment.Points, func(i, j int) bool {
			a, b := lastSegment.Points[i], lastSegment.Points[j]
			if a.ObservedAt.Time.Equal(b.ObservedAt.Time) {
				if a.Source == b.Source {
					return a.SourceObservationID < b.SourceObservationID
				}
				return a.Source < b.Source
			}
			return a.ObservedAt.Time.Before(b.ObservedAt.Time)
		})
		return AppendAdded, nil
	}
	t.Segments = append(t.Segments, TrackSegment{Points: []PositionObservation{p}})
	return AppendAdded, nil
}

func samePosition(a, b PositionObservation) bool {
	return a.ObservedAt == b.ObservedAt && a.Latitude == b.Latitude && a.Longitude == b.Longitude && a.AltitudeMeters == b.AltitudeMeters && a.GroundSpeedMPS == b.GroundSpeedMPS && a.HeadingDegrees == b.HeadingDegrees
}

func (t Track) Validate() error {
	for si, segment := range t.Segments {
		if len(segment.Points) == 0 {
			return fmt.Errorf("segment %d: %w", si, shared.NewDomainError(shared.ErrInvalidInput, "track segments cannot be empty"))
		}
		for i, point := range segment.Points {
			if _, err := NewPositionObservation(point); err != nil {
				return fmt.Errorf("segment %d point %d: %w", si, i, err)
			}
			if i > 0 && point.ObservedAt.Time.Before(segment.Points[i-1].ObservedAt.Time) {
				return shared.NewDomainError(shared.ErrInvalidInput, "track segment points must be chronological")
			}
		}
	}
	return nil
}
