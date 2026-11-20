package bootstrap

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	trackingapp "github.com/ppotepa/terminal-velocity/backend/internal/application/tracking"
	watchapp "github.com/ppotepa/terminal-velocity/backend/internal/application/watchlist"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/flight"
	shared "github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/watch"
	httpaircraft "github.com/ppotepa/terminal-velocity/backend/internal/transport/http/aircraft"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
)

type aircraftReader struct {
	tracking *trackingapp.Service
	rules    *watchapp.Service
}
type watchedFixture struct {
	aircraftID shared.AircraftID
	callsign   string
}

func (r aircraftReader) watched(ctx context.Context) ([]watchedFixture, error) {
	out := []watchedFixture{}
	cursor := ""
	for page := 0; page < 10; page++ {
		items, next, err := r.rules.ListEnabled(ctx, cursor, 1000)
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			for _, name := range fixtureCallsigns(item.Rule) {
				candidate := watchedFixture{aircraftID: fixtureAircraftID(name), callsign: name}
				out = append(out, candidate)
			}
		}
		if next == "" {
			break
		}
		cursor = next
	}
	sort.Slice(out, func(i, j int) bool { return out[i].aircraftID < out[j].aircraftID })
	dedup := out[:0]
	seen := map[shared.AircraftID]bool{}
	for _, item := range out {
		if !seen[item.aircraftID] {
			seen[item.aircraftID] = true
			dedup = append(dedup, item)
		}
	}
	return dedup, nil
}
func (r aircraftReader) MapSnapshot(ctx context.Context) (httpaircraft.MapSnapshot, error) {
	items, err := r.watched(ctx)
	if err != nil {
		return httpaircraft.MapSnapshot{}, err
	}
	out := make([]httpaircraft.MapAircraft, 0, len(items))
	fresh := false
	now := time.Now().UTC()
	for _, item := range items {
		current, e := r.tracking.Current(ctx, item.aircraftID)
		if errors.Is(e, driver.ErrNoDocuments) {
			continue
		}
		if e != nil {
			return httpaircraft.MapSnapshot{}, e
		}
		position := toHTTPPosition(current.Observation)
		if now.Sub(position.ObservedAt) < 2*time.Minute {
			fresh = true
		}
		var flightID *string
		if current.FlightID.Valid {
			v := string(current.FlightID.Value)
			flightID = &v
		}
		out = append(out, httpaircraft.MapAircraft{AircraftID: string(item.aircraftID), Position: &position, FlightID: flightID})
	}
	freshness := "unknown"
	if len(out) > 0 {
		freshness = "stale"
		if fresh {
			freshness = "fresh"
		}
	}
	return httpaircraft.MapSnapshot{GeneratedAt: now, SourceFreshness: freshness, Aircraft: out}, nil
}
func (r aircraftReader) ListAircraft(ctx context.Context, cursor string, limit int) (httpaircraft.AircraftPage, error) {
	items, err := r.watched(ctx)
	if err != nil {
		return httpaircraft.AircraftPage{}, err
	}
	out := []httpaircraft.Aircraft{}
	for _, item := range items {
		if item.aircraftID <= shared.AircraftID(cursor) {
			continue
		}
		current, e := r.tracking.Current(ctx, item.aircraftID)
		if errors.Is(e, driver.ErrNoDocuments) {
			continue
		}
		if e != nil {
			return httpaircraft.AircraftPage{}, e
		}
		position := toHTTPPosition(current.Observation)
		out = append(out, httpaircraft.Aircraft{ID: string(item.aircraftID), Identifiers: []httpaircraft.IdentifierAssertion{}, CurrentPosition: &position})
	}
	next := (*string)(nil)
	if len(out) > limit {
		out = out[:limit]
		v := out[len(out)-1].ID
		next = &v
	}
	return httpaircraft.AircraftPage{Items: out, NextCursor: next}, nil
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
func (r aircraftReader) ListFlights(ctx context.Context, q httpaircraft.FlightQuery) (httpaircraft.FlightPage, error) {
	watched, err := r.watched(ctx)
	if err != nil {
		return httpaircraft.FlightPage{}, err
	}
	out := []httpaircraft.Flight{}
	seen := map[shared.FlightID]bool{}
	for _, item := range watched {
		if q.AircraftID.Valid && q.AircraftID.Value != item.aircraftID {
			continue
		}
		current, e := r.tracking.Current(ctx, item.aircraftID)
		if errors.Is(e, driver.ErrNoDocuments) || e == nil && !current.FlightID.Valid {
			continue
		}
		if e != nil {
			return httpaircraft.FlightPage{}, e
		}
		if seen[current.FlightID.Value] || string(current.FlightID.Value) <= q.Cursor {
			continue
		}
		seen[current.FlightID.Value] = true
		flight, e := r.flightSummary(ctx, item, current)
		if e != nil {
			return httpaircraft.FlightPage{}, e
		}
		if flight.StartedAt != nil {
			if q.StartedAfter.Valid && flight.StartedAt.ObservedAt.Before(q.StartedAfter.Value) || q.StartedBefore.Valid && flight.StartedAt.ObservedAt.After(q.StartedBefore.Value) {
				continue
			}
		}
		out = append(out, flight)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	limit := q.Limit
	if limit < 1 {
		limit = 50
	}
	var next *string
	if len(out) > limit {
		out = out[:limit]
		v := out[len(out)-1].ID
		next = &v
	}
	return httpaircraft.FlightPage{Items: out, NextCursor: next}, nil
}
func (r aircraftReader) GetFlight(ctx context.Context, id shared.FlightID) (httpaircraft.Flight, error) {
	watched, err := r.watched(ctx)
	if err != nil {
		return httpaircraft.Flight{}, err
	}
	for _, item := range watched {
		current, e := r.tracking.Current(ctx, item.aircraftID)
		if e != nil {
			if errors.Is(e, driver.ErrNoDocuments) {
				continue
			}
			return httpaircraft.Flight{}, e
		}
		if current.FlightID.Valid && current.FlightID.Value == id {
			return r.flightSummary(ctx, item, current)
		}
	}
	return httpaircraft.Flight{}, httpaircraft.ErrNotFound
}
func (r aircraftReader) flightSummary(ctx context.Context, item watchedFixture, current trackingapp.CurrentPosition) (httpaircraft.Flight, error) {
	flight := httpaircraft.Flight{ID: string(current.FlightID.Value), AircraftID: stringPtr(string(item.aircraftID))}
	from := time.Now().UTC().Add(-10 * 365 * 24 * time.Hour)
	page, err := r.tracking.FlightTrack(ctx, current.FlightID.Value, from, time.Now().UTC().Add(time.Minute), nil, trackingapp.MaxHistoryLimit)
	if err != nil {
		return httpaircraft.Flight{}, err
	}
	if len(page.Segments) > 0 && len(page.Segments[0].Points) > 0 {
		first := page.Segments[0].Points[0].Observation
		flight.StartedAt = &httpaircraft.BoundaryEvidence{ObservedAt: first.ObservedAt.Time, Certainty: "inferred", Source: "observed_track"}
	}
	return flight, nil
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
func fixtureCallsigns(rule watch.WatchRule) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, group := range rule.Groups {
		for _, criterion := range group.Criteria {
			if criterion.Kind != watch.CriterionCallsign {
				continue
			}
			value := strings.TrimSpace(strings.ToUpper(criterion.Value))
			if strings.HasSuffix(value, "*") {
				value = strings.TrimSuffix(value, "*") + "42"
			}
			if value != "" && !seen[value] {
				seen[value] = true
				out = append(out, value)
			}
		}
	}
	return out
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
