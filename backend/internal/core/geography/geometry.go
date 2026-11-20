// Package geography provides pure, conservative spatial predicates and crossing
// evidence. It does not load external country data.
package geography

import (
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

const earthRadiusMeters = 6371008.8

type GeoPoint struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

func NewGeoPoint(lat, lon float64) (GeoPoint, error) {
	if !finite(lat) || lat < -90 || lat > 90 {
		return GeoPoint{}, shared.NewDomainError(shared.ErrOutOfRange, "latitude must be finite and within [-90, 90]")
	}
	if !finite(lon) || lon < -180 || lon > 180 {
		return GeoPoint{}, shared.NewDomainError(shared.ErrOutOfRange, "longitude must be finite and within [-180, 180]")
	}
	return GeoPoint{Latitude: lat, Longitude: lon}, nil
}

type CountryCode string

func NewCountryCode(value string) (CountryCode, error) {
	value = strings.ToUpper(strings.TrimSpace(value))
	if len(value) != 2 {
		return "", shared.NewDomainError(shared.ErrInvalidInput, "country code must be two ASCII letters")
	}
	for _, ch := range value {
		if ch < 'A' || ch > 'Z' {
			return "", shared.NewDomainError(shared.ErrInvalidInput, "country code must be two ASCII letters")
		}
	}
	return CountryCode(value), nil
}

type AreaKind string

const (
	AreaPolygon  AreaKind = "polygon"
	AreaRadius   AreaKind = "radius"
	AreaCorridor AreaKind = "corridor"
)

type GeoArea struct {
	ID           string       `json:"id"`
	Kind         AreaKind     `json:"kind"`
	Outer        []GeoPoint   `json:"outer,omitempty"`
	Holes        [][]GeoPoint `json:"holes,omitempty"`
	Center       GeoPoint     `json:"center,omitempty"`
	RadiusMeters float64      `json:"radius_meters,omitempty"`
	Path         []GeoPoint   `json:"path,omitempty"`
	WidthMeters  float64      `json:"width_meters,omitempty"`
}

func NewPolygonArea(id string, outer []GeoPoint, holes [][]GeoPoint) (GeoArea, error) {
	area := GeoArea{ID: strings.TrimSpace(id), Kind: AreaPolygon, Outer: cloneRing(outer), Holes: cloneRings(holes)}
	if err := area.Validate(); err != nil {
		return GeoArea{}, err
	}
	return area, nil
}

func NewRadiusArea(id string, center GeoPoint, radiusMeters float64) (GeoArea, error) {
	area := GeoArea{ID: strings.TrimSpace(id), Kind: AreaRadius, Center: center, RadiusMeters: radiusMeters}
	if err := area.Validate(); err != nil {
		return GeoArea{}, err
	}
	return area, nil
}

func NewCorridorArea(id string, path []GeoPoint, widthMeters float64) (GeoArea, error) {
	area := GeoArea{ID: strings.TrimSpace(id), Kind: AreaCorridor, Path: append([]GeoPoint(nil), path...), WidthMeters: widthMeters}
	if err := area.Validate(); err != nil {
		return GeoArea{}, err
	}
	return area, nil
}

func (a GeoArea) Validate() error {
	if _, err := shared.NewSourceID(a.ID); err != nil {
		return fmt.Errorf("area id: %w", err)
	}
	switch a.Kind {
	case AreaPolygon:
		if err := validateRing(a.Outer); err != nil {
			return fmt.Errorf("outer ring: %w", err)
		}
		for i, hole := range a.Holes {
			if err := validateRing(hole); err != nil {
				return fmt.Errorf("hole %d: %w", i, err)
			}
		}
	case AreaRadius:
		if _, err := NewGeoPoint(a.Center.Latitude, a.Center.Longitude); err != nil {
			return err
		}
		if !finite(a.RadiusMeters) || a.RadiusMeters <= 0 || a.RadiusMeters > 20000000 {
			return shared.NewDomainError(shared.ErrOutOfRange, "radius must be within (0, 20,000,000] meters")
		}
	case AreaCorridor:
		if len(a.Path) < 2 {
			return shared.NewDomainError(shared.ErrInvalidInput, "corridor requires at least two points")
		}
		for _, p := range a.Path {
			if _, err := NewGeoPoint(p.Latitude, p.Longitude); err != nil {
				return err
			}
		}
		if !finite(a.WidthMeters) || a.WidthMeters <= 0 || a.WidthMeters > 1000000 {
			return shared.NewDomainError(shared.ErrOutOfRange, "corridor width must be within (0, 1,000,000] meters")
		}
	default:
		return shared.NewDomainError(shared.ErrInvalidInput, "unsupported geographic area kind")
	}
	return nil
}

type SpatialMatch string

const (
	SpatialInside  SpatialMatch = "inside"
	SpatialOutside SpatialMatch = "outside"
	SpatialUnknown SpatialMatch = "unknown"
)

func MatchArea(area GeoArea, point shared.Optional[GeoPoint]) SpatialMatch {
	if !point.Valid || area.Validate() != nil {
		return SpatialUnknown
	}
	p := point.Value
	if _, err := NewGeoPoint(p.Latitude, p.Longitude); err != nil {
		return SpatialUnknown
	}
	switch area.Kind {
	case AreaPolygon:
		if !pointInRing(p, area.Outer) {
			return SpatialOutside
		}
		for _, hole := range area.Holes {
			if pointInRing(p, hole) {
				return SpatialOutside
			}
		}
		return SpatialInside
	case AreaRadius:
		if haversine(p, area.Center) <= area.RadiusMeters {
			return SpatialInside
		}
		return SpatialOutside
	case AreaCorridor:
		for i := 1; i < len(area.Path); i++ {
			if segmentDistanceMeters(p, area.Path[i-1], area.Path[i]) <= area.WidthMeters/2 {
				return SpatialInside
			}
		}
		return SpatialOutside
	default:
		return SpatialUnknown
	}
}

type CrossingStatus string

const (
	CrossingObserved CrossingStatus = "observed"
	CrossingInferred CrossingStatus = "inferred"
	CrossingUnknown  CrossingStatus = "unknown"
	CrossingNoChange CrossingStatus = "no_change"
)

type Crossing struct {
	AreaID     string                                  `json:"area_id"`
	FromInside bool                                    `json:"from_inside"`
	ToInside   bool                                    `json:"to_inside"`
	Status     CrossingStatus                          `json:"status"`
	At         shared.Optional[shared.ObservationTime] `json:"at,omitempty"`
	Reason     string                                  `json:"reason"`
	EventKey   string                                  `json:"event_key,omitempty"`
}

type Observation struct {
	Point GeoPoint
	At    shared.ObservationTime
}

// EvaluateCrossing compares consecutive observations. A boundary flip over a
// plausible interval is INFERRED because no sample proves the exact crossing
// time. Missing, uncertain or discontinuous evidence stays UNKNOWN.
func EvaluateCrossing(area GeoArea, previous, current shared.Optional[Observation], maxGap time.Duration) Crossing {
	out := Crossing{AreaID: area.ID, Status: CrossingUnknown}
	if area.Validate() != nil {
		out.Reason = "invalid_area"
		return out
	}
	if !previous.Valid || !current.Valid {
		out.Reason = "position_evidence_missing"
		return out
	}
	if maxGap <= 0 {
		out.Reason = "maximum_gap_must_be_positive"
		return out
	}
	from, to := previous.Value, current.Value
	if from.At.Time.IsZero() || to.At.Time.IsZero() {
		out.Reason = "observation_time_missing"
		return out
	}
	if to.At.Time.Before(from.At.Time) {
		out.Reason = "out_of_order_observations"
		return out
	}
	if to.At.Time.Sub(from.At.Time) > maxGap {
		out.Reason = "track_gap_too_long"
		return out
	}
	if math.Abs(to.Point.Longitude-from.Point.Longitude) > 180 {
		out.Reason = "antimeridian_discontinuity"
		return out
	}
	first, second := MatchArea(area, shared.Some(from.Point)), MatchArea(area, shared.Some(to.Point))
	if first == SpatialUnknown || second == SpatialUnknown {
		out.Reason = "spatial_match_unknown"
		return out
	}
	if first == second {
		out.Status = CrossingNoChange
		out.FromInside = first == SpatialInside
		out.ToInside = second == SpatialInside
		out.Reason = "membership_unchanged"
		return out
	}
	if from.At.Uncertainty > 0 || to.At.Uncertainty > 0 {
		out.Reason = "observation_time_uncertainty_prevents_confirmed_transition"
		return out
	}
	out.FromInside, out.ToInside = first == SpatialInside, second == SpatialInside
	if areaBoundary(area, from.Point) {
		out.Status, out.At, out.Reason = CrossingObserved, shared.Some(from.At), "boundary_position_observed"
	} else if areaBoundary(area, to.Point) {
		out.Status, out.At, out.Reason = CrossingObserved, shared.Some(to.At), "boundary_position_observed"
	} else {
		out.Status = CrossingInferred
		out.At = shared.Some(shared.ObservationTime{Time: from.At.Time.Add(to.At.Time.Sub(from.At.Time) / 2).UTC(), Precision: maxDuration(from.At.Precision, to.At.Precision), Uncertainty: to.At.Time.Sub(from.At.Time) / 2})
		out.Reason = "membership_changed_between_observations"
	}
	out.EventKey = fmt.Sprintf("%s:%t:%t:%d:%d", area.ID, out.FromInside, out.ToInside, from.At.Time.UnixNano(), to.At.Time.UnixNano())
	return out
}

type GeofencePredicate struct {
	Area           GeoArea
	TriggerOnEntry bool
}

func (g GeofencePredicate) Matches(point shared.Optional[GeoPoint]) SpatialMatch {
	return MatchArea(g.Area, point)
}

func validateRing(ring []GeoPoint) error {
	if len(ring) < 4 || ring[0] != ring[len(ring)-1] {
		return shared.NewDomainError(shared.ErrInvalidInput, "ring must contain at least three vertices and be closed")
	}
	for _, p := range ring {
		if _, err := NewGeoPoint(p.Latitude, p.Longitude); err != nil {
			return err
		}
	}
	return nil
}

func pointInRing(point GeoPoint, ring []GeoPoint) bool {
	inside := false
	px := unwrapLongitude(point.Longitude, ring[0].Longitude)
	longitudes := make([]float64, len(ring))
	longitudes[0] = unwrapLongitude(ring[0].Longitude, px)
	for i := 1; i < len(ring); i++ {
		longitudes[i] = unwrapLongitude(ring[i].Longitude, longitudes[i-1])
	}
	for i, j := 0, len(ring)-1; i < len(ring); j, i = i, i+1 {
		a, b := ring[j], ring[i]
		ax, bx := longitudes[j], longitudes[i]
		if pointOnSegment(px, point.Latitude, ax, a.Latitude, bx, b.Latitude) {
			return true
		}
		intersects := (a.Latitude > point.Latitude) != (b.Latitude > point.Latitude) && px < (bx-ax)*(point.Latitude-a.Latitude)/(b.Latitude-a.Latitude)+ax
		if intersects {
			inside = !inside
		}
	}
	return inside
}

func areaBoundary(area GeoArea, p GeoPoint) bool {
	switch area.Kind {
	case AreaPolygon:
		if onRingBoundary(p, area.Outer) {
			return true
		}
		for _, hole := range area.Holes {
			if onRingBoundary(p, hole) {
				return true
			}
		}
	case AreaRadius:
		return math.Abs(haversine(p, area.Center)-area.RadiusMeters) <= 1
	case AreaCorridor:
		for i := 1; i < len(area.Path); i++ {
			if math.Abs(segmentDistanceMeters(p, area.Path[i-1], area.Path[i])-area.WidthMeters/2) <= 1 {
				return true
			}
		}
	}
	return false
}

func onRingBoundary(p GeoPoint, ring []GeoPoint) bool {
	px := unwrapLongitude(p.Longitude, ring[0].Longitude)
	longitudes := make([]float64, len(ring))
	longitudes[0] = unwrapLongitude(ring[0].Longitude, px)
	for i := 1; i < len(ring); i++ {
		longitudes[i] = unwrapLongitude(ring[i].Longitude, longitudes[i-1])
	}
	for i := 1; i < len(ring); i++ {
		a, b := ring[i-1], ring[i]
		if pointOnSegment(px, p.Latitude, longitudes[i-1], a.Latitude, longitudes[i], b.Latitude) {
			return true
		}
	}
	return false
}

func unwrapLongitude(lon, around float64) float64 {
	for lon-around > 180 {
		lon -= 360
	}
	for lon-around < -180 {
		lon += 360
	}
	return lon
}

func pointOnSegment(px, py, ax, ay, bx, by float64) bool {
	cross := (px-ax)*(by-ay) - (py-ay)*(bx-ax)
	if math.Abs(cross) > 1e-10 {
		return false
	}
	return px >= math.Min(ax, bx)-1e-10 && px <= math.Max(ax, bx)+1e-10 && py >= math.Min(ay, by)-1e-10 && py <= math.Max(ay, by)+1e-10
}

func haversine(a, b GeoPoint) float64 {
	lat1, lat2 := radians(a.Latitude), radians(b.Latitude)
	dLat, dLon := radians(b.Latitude-a.Latitude), radians(b.Longitude-a.Longitude)
	x := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * earthRadiusMeters * math.Asin(math.Sqrt(math.Min(1, x)))
}

func segmentDistanceMeters(point, start, end GeoPoint) float64 {
	latScale := radians(point.Latitude)
	toXY := func(p GeoPoint) (float64, float64) {
		return radians(unwrapLongitude(p.Longitude, point.Longitude)-point.Longitude) * earthRadiusMeters * math.Cos(latScale), radians(p.Latitude-point.Latitude) * earthRadiusMeters
	}
	ax, ay := toXY(start)
	bx, by := toXY(end)
	dx, dy := bx-ax, by-ay
	denom := dx*dx + dy*dy
	t := 0.0
	if denom > 0 {
		t = math.Max(0, math.Min(1, -(ax*dx+ay*dy)/denom))
	}
	return math.Hypot(ax+t*dx, ay+t*dy)
}

func radians(degrees float64) float64      { return degrees * math.Pi / 180 }
func finite(value float64) bool            { return !math.IsNaN(value) && !math.IsInf(value, 0) }
func cloneRing(ring []GeoPoint) []GeoPoint { return append([]GeoPoint(nil), ring...) }
func cloneRings(rings [][]GeoPoint) [][]GeoPoint {
	result := make([][]GeoPoint, len(rings))
	for i := range rings {
		result[i] = cloneRing(rings[i])
	}
	return result
}
func maxDuration(a, b time.Duration) time.Duration {
	if a > b {
		return a
	}
	return b
}
