// Package geography resolves observed positions against versioned country
// polygons and emits conservative, evidence-carrying entry events.
package geography

import (
	"fmt"
	"sort"
	"time"

	core "github.com/ppotepa/terminal-velocity/backend/internal/core/geography"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

type CountryBoundary struct {
	Code  core.CountryCode `json:"code"`
	Name  string           `json:"name"`
	Areas []core.GeoArea   `json:"-"`
}

type Dataset struct {
	Version   string            `json:"version"`
	Source    string            `json:"source"`
	License   string            `json:"license"`
	Countries []CountryBoundary `json:"countries"`
}

func (d Dataset) Validate() error {
	if d.Version == "" || d.Source == "" || d.License == "" {
		return fmt.Errorf("geography dataset requires version, source and license provenance")
	}
	if len(d.Countries) == 0 {
		return fmt.Errorf("geography dataset contains no countries")
	}
	seen := map[core.CountryCode]bool{}
	for _, country := range d.Countries {
		code, err := core.NewCountryCode(string(country.Code))
		if err != nil {
			return err
		}
		if seen[code] {
			return fmt.Errorf("duplicate country code %s", code)
		}
		seen[code] = true
		if country.Name == "" || len(country.Areas) == 0 {
			return fmt.Errorf("country %s has no name or polygon", code)
		}
		for _, area := range country.Areas {
			if area.Validate() != nil {
				return fmt.Errorf("country %s contains invalid polygon", code)
			}
		}
	}
	return nil
}

type CountryPresence struct {
	Code  core.CountryCode  `json:"code"`
	Name  string            `json:"name"`
	Match core.SpatialMatch `json:"match"`
}
type CrossingEvent struct {
	AircraftID shared.AircraftID                `json:"aircraft_id"`
	FlightID   shared.Optional[shared.FlightID] `json:"flight_id,omitempty"`
	Country    core.CountryCode                 `json:"country"`
	Evidence   core.Crossing                    `json:"evidence"`
}

type Service struct {
	dataset Dataset
	maxGap  time.Duration
}

func NewService(dataset Dataset, maxGap time.Duration) (*Service, error) {
	if err := dataset.Validate(); err != nil {
		return nil, err
	}
	if maxGap <= 0 {
		return nil, shared.NewDomainError(shared.ErrInvalidInput, "maximum crossing gap must be positive")
	}
	return &Service{dataset: dataset, maxGap: maxGap}, nil
}

func (s *Service) DatasetInfo() Dataset {
	out := s.dataset
	out.Countries = append([]CountryBoundary(nil), s.dataset.Countries...)
	for i := range out.Countries {
		areas := out.Countries[i].Areas
		out.Countries[i].Areas = make([]core.GeoArea, len(areas))
		for j, area := range areas {
			area.Outer = append([]core.GeoPoint(nil), area.Outer...)
			area.Holes = append([][]core.GeoPoint(nil), area.Holes...)
			for k := range area.Holes {
				area.Holes[k] = append([]core.GeoPoint(nil), area.Holes[k]...)
			}
			area.Path = append([]core.GeoPoint(nil), area.Path...)
			out.Countries[i].Areas[j] = area
		}
	}
	return out
}

func (s *Service) CountriesAt(point shared.Optional[core.GeoPoint]) []CountryPresence {
	if !point.Valid {
		return []CountryPresence{}
	}
	out := make([]CountryPresence, 0)
	for _, country := range s.dataset.Countries {
		match := core.SpatialOutside
		for _, area := range country.Areas {
			if m := core.MatchArea(area, point); m == core.SpatialInside {
				match = m
				break
			}
		}
		if match == core.SpatialInside {
			out = append(out, CountryPresence{Code: country.Code, Name: country.Name, Match: match})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Code < out[j].Code })
	return out
}

type BoundingBox struct{ MinLatitude, MinLongitude, MaxLatitude, MaxLongitude float64 }

func (b BoundingBox) Validate() error {
	if _, err := core.NewGeoPoint(b.MinLatitude, b.MinLongitude); err != nil {
		return err
	}
	if _, err := core.NewGeoPoint(b.MaxLatitude, b.MaxLongitude); err != nil {
		return err
	}
	if b.MinLatitude > b.MaxLatitude {
		return shared.NewDomainError(shared.ErrInvalidInput, "bbox minimum latitude exceeds maximum")
	}
	return nil
}
func (b BoundingBox) Contains(p core.GeoPoint) bool {
	lon := p.Longitude >= b.MinLongitude && p.Longitude <= b.MaxLongitude
	if b.MinLongitude > b.MaxLongitude {
		lon = p.Longitude >= b.MinLongitude || p.Longitude <= b.MaxLongitude
	}
	return p.Latitude >= b.MinLatitude && p.Latitude <= b.MaxLatitude && lon
}

type PositionFilter struct {
	BBox      *BoundingBox
	Area      *core.GeoArea
	Countries []core.CountryCode
}

func (s *Service) FilterPositions(points []core.Observation, filter PositionFilter) ([]core.Observation, error) {
	if filter.BBox != nil {
		if err := filter.BBox.Validate(); err != nil {
			return nil, err
		}
	}
	if filter.Area != nil {
		if err := filter.Area.Validate(); err != nil {
			return nil, err
		}
	}
	allowed := map[core.CountryCode]bool{}
	for _, code := range filter.Countries {
		validated, err := core.NewCountryCode(string(code))
		if err != nil {
			return nil, err
		}
		allowed[validated] = true
	}
	out := make([]core.Observation, 0, len(points))
	for _, p := range points {
		if p.At.Time.IsZero() {
			continue
		}
		if _, err := core.NewGeoPoint(p.Point.Latitude, p.Point.Longitude); err != nil {
			continue
		}
		if filter.BBox != nil && !filter.BBox.Contains(p.Point) {
			continue
		}
		if filter.Area != nil && core.MatchArea(*filter.Area, shared.Some(p.Point)) != core.SpatialInside {
			continue
		}
		if len(allowed) > 0 {
			matched := false
			for _, country := range s.CountriesAt(shared.Some(p.Point)) {
				if allowed[country.Code] {
					matched = true
					break
				}
			}
			if !matched {
				continue
			}
		}
		out = append(out, p)
	}
	return out, nil
}

// EntryEvents reports country entries once per consecutive observed pair. A
// long gap, missing point or dateline discontinuity is carried as UNKNOWN and
// never promoted to an inferred crossing.
func (s *Service) EntryEvents(aircraft shared.AircraftID, flight shared.Optional[shared.FlightID], track []shared.Optional[core.Observation]) []CrossingEvent {
	out := make([]CrossingEvent, 0)
	seen := map[string]bool{}
	for i := 1; i < len(track); i++ {
		previous, current := track[i-1], track[i]
		for _, country := range s.dataset.Countries {
			from, to := countryMembership(country, previous), countryMembership(country, current)
			if current.Valid && to == core.SpatialOutside {
				continue
			}
			if !current.Valid || !previous.Valid || from == core.SpatialUnknown || to == core.SpatialUnknown {
				ev := core.Crossing{AreaID: string(country.Code), Status: core.CrossingUnknown, Reason: "position_evidence_missing"}
				out = append(out, CrossingEvent{AircraftID: aircraft, FlightID: flight, Country: country.Code, Evidence: ev})
				continue
			}
			if from == core.SpatialInside {
				continue
			}
			if previous.Value.At.Time.IsZero() || current.Value.At.Time.IsZero() {
				ev := core.Crossing{AreaID: string(country.Code), FromInside: false, ToInside: true, Status: core.CrossingUnknown, Reason: "observation_time_missing"}
				out = append(out, CrossingEvent{AircraftID: aircraft, FlightID: flight, Country: country.Code, Evidence: ev})
				continue
			}
			if current.Value.At.Time.Before(previous.Value.At.Time) || current.Value.At.Time.Sub(previous.Value.At.Time) > s.maxGap || abs(current.Value.Point.Longitude-previous.Value.Point.Longitude) > 180 {
				reason := "track_gap_too_long"
				if current.Value.At.Time.Before(previous.Value.At.Time) {
					reason = "out_of_order_observations"
				}
				if abs(current.Value.Point.Longitude-previous.Value.Point.Longitude) > 180 {
					reason = "antimeridian_discontinuity"
				}
				ev := core.Crossing{AreaID: string(country.Code), FromInside: false, ToInside: true, Status: core.CrossingUnknown, Reason: reason}
				out = append(out, CrossingEvent{AircraftID: aircraft, FlightID: flight, Country: country.Code, Evidence: ev})
				continue
			}
			if previous.Value.At.Uncertainty > 0 || current.Value.At.Uncertainty > 0 {
				ev := core.Crossing{AreaID: string(country.Code), FromInside: false, ToInside: true, Status: core.CrossingUnknown, Reason: "observation_time_uncertainty_prevents_confirmed_transition"}
				out = append(out, CrossingEvent{AircraftID: aircraft, FlightID: flight, Country: country.Code, Evidence: ev})
				continue
			}
			var crossing core.Crossing
			for _, area := range country.Areas {
				crossing = core.EvaluateCrossing(area, previous, current, s.maxGap)
				if crossing.Status == core.CrossingObserved || crossing.Status == core.CrossingInferred {
					break
				}
			}
			if crossing.Status != core.CrossingObserved && crossing.Status != core.CrossingInferred {
				crossing = core.Crossing{AreaID: string(country.Code), FromInside: false, ToInside: true, Status: core.CrossingUnknown, Reason: "country_entry_evidence_unresolved"}
			}
			if crossing.EventKey != "" && seen[crossing.EventKey] {
				continue
			}
			if crossing.EventKey != "" {
				seen[crossing.EventKey] = true
			}
			out = append(out, CrossingEvent{AircraftID: aircraft, FlightID: flight, Country: country.Code, Evidence: crossing})
		}
	}
	return out
}

func countryMembership(c CountryBoundary, p shared.Optional[core.Observation]) core.SpatialMatch {
	if !p.Valid {
		return core.SpatialUnknown
	}
	if _, err := core.NewGeoPoint(p.Value.Point.Latitude, p.Value.Point.Longitude); err != nil {
		return core.SpatialUnknown
	}
	for _, a := range c.Areas {
		if core.MatchArea(a, shared.Some(p.Value.Point)) == core.SpatialInside {
			return core.SpatialInside
		}
	}
	return core.SpatialOutside
}
func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

// Observation validates the evidence primitives before a caller appends them
// to a track; no interpolation or synthetic position is created here.
func Observation(point core.GeoPoint, at shared.ObservationTime) (core.Observation, error) {
	if _, err := core.NewGeoPoint(point.Latitude, point.Longitude); err != nil {
		return core.Observation{}, err
	}
	if at.Time.IsZero() || at.Uncertainty < 0 || at.Precision < 0 {
		return core.Observation{}, shared.NewDomainError(shared.ErrInvalidInput, "valid observation time is required")
	}
	at.Time = at.Time.UTC()
	return core.Observation{Point: point, At: at}, nil
}
