// Package watch contains the pure WatchRule aggregate and candidate matcher.
// It never performs acquisition; adapters plan bounded source queries elsewhere.
package watch

import (
	"fmt"
	"math"
	"strings"
	"time"

	geometry "github.com/ppotepa/terminal-velocity/backend/internal/core/geography"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

type Status string

const (
	StatusActive  Status = "active"
	StatusPaused  Status = "paused"
	StatusDeleted Status = "deleted"
)

type Scope string

const (
	ScopeTargeted      Scope = "targeted"
	ScopeAreaDiscovery Scope = "area_discovery"
)

type GroupMode string

const (
	GroupAny GroupMode = "any"
	GroupAll GroupMode = "all"
)

type CriterionKind string

const (
	CriterionCallsign     CriterionKind = "callsign"
	CriterionICAO24       CriterionKind = "icao24"
	CriterionRegistration CriterionKind = "registration"
	CriterionOperator     CriterionKind = "operator"
	CriterionOrigin       CriterionKind = "origin"
	CriterionDestination  CriterionKind = "destination"
	CriterionArea         CriterionKind = "area"
	CriterionProtocol     CriterionKind = "protocol"
)

type Criterion struct {
	Kind  CriterionKind `json:"kind"`
	Value string        `json:"value"`
}

type CriteriaGroup struct {
	Mode     GroupMode   `json:"mode"`
	Criteria []Criterion `json:"criteria"`
}

type CollectionPreferences struct {
	Positions  bool     `json:"positions"`
	Messages   bool     `json:"messages"`
	DecoderIDs []string `json:"decoder_ids,omitempty"`
}

type Window struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}

type DiscoveryBounds struct {
	AreaID        string `json:"area_id"`
	MaxCandidates int    `json:"max_candidates"`
}

// AdvancedFilters are evaluated only against retained, evidence-backed observations.
// They never create or broaden acquisition queries by themselves.
type AdvancedFilters struct {
	CountryCodes   []string            `json:"countryCodes,omitempty"`
	AltitudeMeters *AltitudeRange      `json:"altitudeMeters,omitempty"`
	Route          *FlightRoute        `json:"route,omitempty"`
	Geofence       *GeoJSONPolygon     `json:"geofence,omitempty"`
	FlightPath     *FlightPathCorridor `json:"flightPath,omitempty"`
}

type AltitudeRange struct {
	Min *float64 `json:"min,omitempty"`
	Max *float64 `json:"max,omitempty"`
}
type FlightRoute struct {
	Origin      string   `json:"origin,omitempty"`
	Destination string   `json:"destination,omitempty"`
	Via         []string `json:"via,omitempty"`
}

// GeoJSONPosition follows RFC 7946 coordinate order: longitude, latitude.
type GeoJSONPosition [2]float64
type GeoJSONPolygon struct {
	Type        string              `json:"type"`
	Coordinates [][]GeoJSONPosition `json:"coordinates"`
}
type FlightPathCorridor struct {
	Type        string            `json:"type"`
	Coordinates []GeoJSONPosition `json:"coordinates"`
	WidthMeters float64           `json:"widthMeters"`
}

type WatchRule struct {
	ID         shared.WatchRuleID    `json:"id"`
	Name       string                `json:"name"`
	Status     Status                `json:"status"`
	Scope      Scope                 `json:"scope"`
	Groups     []CriteriaGroup       `json:"groups"`
	Window     *Window               `json:"window,omitempty"`
	Discovery  *DiscoveryBounds      `json:"discovery,omitempty"`
	Filters    *AdvancedFilters      `json:"filters,omitempty"`
	Collection CollectionPreferences `json:"collection"`
}

// NewWatchRule validates an aggregate without performing any I/O.
func NewWatchRule(rule WatchRule) (WatchRule, error) {
	if _, err := shared.NewWatchRuleID(string(rule.ID)); err != nil {
		return WatchRule{}, fmt.Errorf("watch rule id: %w", err)
	}
	rule.Name = strings.TrimSpace(rule.Name)
	if rule.Name == "" || len(rule.Name) > 120 {
		return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "watch rule name must contain 1-120 characters")
	}
	if rule.Status == "" {
		rule.Status = StatusActive
	}
	if rule.Status != StatusActive && rule.Status != StatusPaused && rule.Status != StatusDeleted {
		return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "unsupported watch rule status")
	}
	if rule.Scope == "" {
		rule.Scope = ScopeTargeted
	}
	if rule.Scope != ScopeTargeted && rule.Scope != ScopeAreaDiscovery {
		return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "unsupported watch rule scope")
	}
	if len(rule.Groups) == 0 && rule.Scope == ScopeTargeted {
		return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "targeted watch rule requires at least one criterion")
	}
	for gi := range rule.Groups {
		g := &rule.Groups[gi]
		if g.Mode != GroupAny && g.Mode != GroupAll {
			return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "criteria group mode must be any or all")
		}
		if len(g.Criteria) == 0 {
			return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "criteria groups cannot be empty")
		}
		for ci := range g.Criteria {
			c := &g.Criteria[ci]
			v, err := normalizeCriterion(*c)
			if err != nil {
				return WatchRule{}, fmt.Errorf("group %d criterion %d: %w", gi, ci, err)
			}
			c.Value = v
		}
	}
	if rule.Window != nil {
		if rule.Window.Start.IsZero() || rule.Window.End.IsZero() || !rule.Window.End.After(rule.Window.Start) {
			return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "window end must be after a non-zero start")
		}
		rule.Window.Start = rule.Window.Start.UTC()
		rule.Window.End = rule.Window.End.UTC()
		if rule.Window.End.Sub(rule.Window.Start) > 366*24*time.Hour {
			return WatchRule{}, shared.NewDomainError(shared.ErrOutOfRange, "watch window cannot exceed 366 days")
		}
	}
	if rule.Scope == ScopeAreaDiscovery {
		if rule.Discovery == nil || strings.TrimSpace(rule.Discovery.AreaID) == "" {
			return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "area discovery requires a bounded area")
		}
		if rule.Discovery.MaxCandidates < 1 || rule.Discovery.MaxCandidates > 1000 {
			return WatchRule{}, shared.NewDomainError(shared.ErrOutOfRange, "area discovery candidate limit must be between 1 and 1000")
		}
	} else if rule.Discovery != nil {
		return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "targeted monitoring cannot include area discovery bounds")
	}
	if rule.Filters != nil {
		if len(rule.Filters.CountryCodes) > 100 {
			return WatchRule{}, shared.NewDomainError(shared.ErrOutOfRange, "at most 100 country filters may be selected")
		}
		seenCountries := map[string]bool{}
		for i, raw := range rule.Filters.CountryCodes {
			code, err := geometry.NewCountryCode(raw)
			if err != nil {
				return WatchRule{}, fmt.Errorf("country filter %d: %w", i, err)
			}
			if seenCountries[string(code)] {
				return WatchRule{}, shared.NewDomainError(shared.ErrConflict, "country filter codes must be unique")
			}
			seenCountries[string(code)] = true
			rule.Filters.CountryCodes[i] = string(code)
		}
		if rule.Filters.AltitudeMeters != nil {
			r := rule.Filters.AltitudeMeters
			if r.Min == nil && r.Max == nil {
				return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "altitude range requires a minimum or maximum")
			}
			if r.Min != nil && (math.IsNaN(*r.Min) || math.IsInf(*r.Min, 0) || *r.Min < -1000 || *r.Min > 30000) {
				return WatchRule{}, shared.NewDomainError(shared.ErrOutOfRange, "minimum altitude must be between -1000 and 30000 meters")
			}
			if r.Max != nil && (math.IsNaN(*r.Max) || math.IsInf(*r.Max, 0) || *r.Max < -1000 || *r.Max > 30000) {
				return WatchRule{}, shared.NewDomainError(shared.ErrOutOfRange, "maximum altitude must be between -1000 and 30000 meters")
			}
			if r.Min != nil && r.Max != nil && *r.Min > *r.Max {
				return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "minimum altitude cannot exceed maximum altitude")
			}
		}
		if route := rule.Filters.Route; route != nil {
			if route.Origin == "" && route.Destination == "" && len(route.Via) == 0 {
				return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "route filter needs an origin, destination, or waypoint")
			}
			codes := append([]string{}, route.Via...)
			if route.Origin != "" {
				codes = append(codes, route.Origin)
			}
			if route.Destination != "" {
				codes = append(codes, route.Destination)
			}
			if len(route.Via) > 10 {
				return WatchRule{}, shared.NewDomainError(shared.ErrOutOfRange, "route may contain at most 10 waypoints")
			}
			for _, code := range codes {
				normalized, err := normalizeAirport(code)
				if err != nil {
					return WatchRule{}, err
				}
				if code == route.Origin {
					route.Origin = normalized
				}
				if code == route.Destination {
					route.Destination = normalized
				}
			}
			for i := range route.Via {
				normalized, err := normalizeAirport(route.Via[i])
				if err != nil {
					return WatchRule{}, err
				}
				route.Via[i] = normalized
			}
		}
		if rule.Filters.Geofence != nil {
			if _, err := polygonArea(rule.Filters.Geofence); err != nil {
				return WatchRule{}, fmt.Errorf("geofence: %w", err)
			}
		}
		if rule.Filters.FlightPath != nil {
			if _, err := pathArea(rule.Filters.FlightPath); err != nil {
				return WatchRule{}, fmt.Errorf("flight path: %w", err)
			}
		}
	}
	if !rule.Collection.Positions && !rule.Collection.Messages {
		return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "watch rule must collect positions or messages")
	}
	if len(rule.Collection.DecoderIDs) > 0 && !rule.Collection.Messages {
		return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "decoder selection requires message collection")
	}
	if len(rule.Collection.DecoderIDs) > 32 {
		return WatchRule{}, shared.NewDomainError(shared.ErrOutOfRange, "at most 32 decoders may be selected")
	}
	seen := map[string]bool{}
	for i, id := range rule.Collection.DecoderIDs {
		if _, err := shared.NewSourceID(id); err != nil {
			return WatchRule{}, fmt.Errorf("decoder id %d: %w", i, err)
		}
		if seen[id] {
			return WatchRule{}, shared.NewDomainError(shared.ErrConflict, "decoder IDs must be unique")
		}
		seen[id] = true
	}
	return rule, nil
}

func normalizeAirport(raw string) (string, error) {
	code := strings.ToUpper(strings.TrimSpace(raw))
	if len(code) < 3 || len(code) > 4 {
		return "", shared.NewDomainError(shared.ErrInvalidInput, "airport code must contain 3 or 4 characters")
	}
	for _, r := range code {
		if r < 'A' || r > 'Z' {
			if r < '0' || r > '9' {
				return "", shared.NewDomainError(shared.ErrInvalidInput, "airport code must contain only letters and digits")
			}
		}
	}
	return code, nil
}

func polygonArea(p *GeoJSONPolygon) (geometry.GeoArea, error) {
	if p == nil || p.Type != "Polygon" || len(p.Coordinates) == 0 || len(p.Coordinates) > 32 {
		return geometry.GeoArea{}, shared.NewDomainError(shared.ErrInvalidInput, "geofence must be a GeoJSON Polygon with 1-32 rings")
	}
	var outer []geometry.GeoPoint
	holes := make([][]geometry.GeoPoint, 0, len(p.Coordinates)-1)
	total := 0
	for ri, ring := range p.Coordinates {
		total += len(ring)
		if len(ring) > 2000 || total > 5000 {
			return geometry.GeoArea{}, shared.NewDomainError(shared.ErrOutOfRange, "geofence exceeds the 5000 coordinate limit")
		}
		points := make([]geometry.GeoPoint, 0, len(ring))
		for _, pos := range ring {
			points = append(points, geometry.GeoPoint{Longitude: pos[0], Latitude: pos[1]})
		}
		if ri == 0 {
			outer = points
		} else {
			holes = append(holes, points)
		}
	}
	return geometry.NewPolygonArea("watch-geofence", outer, holes)
}
func pathArea(p *FlightPathCorridor) (geometry.GeoArea, error) {
	if p == nil || p.Type != "LineString" || len(p.Coordinates) < 2 || len(p.Coordinates) > 2000 {
		return geometry.GeoArea{}, shared.NewDomainError(shared.ErrInvalidInput, "flight path must be a GeoJSON LineString with 2-2000 coordinates")
	}
	if math.IsNaN(p.WidthMeters) || math.IsInf(p.WidthMeters, 0) || p.WidthMeters <= 0 || p.WidthMeters > 100000 {
		return geometry.GeoArea{}, shared.NewDomainError(shared.ErrOutOfRange, "flight path corridor width must be greater than 0 and at most 100000 meters")
	}
	points := make([]geometry.GeoPoint, 0, len(p.Coordinates))
	for _, pos := range p.Coordinates {
		points = append(points, geometry.GeoPoint{Longitude: pos[0], Latitude: pos[1]})
	}
	return geometry.NewCorridorArea("watch-flight-path", points, p.WidthMeters)
}

func normalizeCriterion(c Criterion) (string, error) {
	v := strings.ToUpper(strings.TrimSpace(c.Value))
	if v == "" {
		return "", shared.NewDomainError(shared.ErrInvalidInput, "criterion value is required")
	}
	switch c.Kind {
	case CriterionCallsign:
		if strings.HasSuffix(v, "*") {
			prefix := strings.TrimSpace(strings.TrimSuffix(v, "*"))
			if prefix == "" || strings.ContainsAny(prefix, "*?/") {
				return "", shared.NewDomainError(shared.ErrInvalidInput, "callsign wildcard is allowed only as one non-empty trailing *")
			}
			if _, err := shared.NewCallsign(prefix); err != nil {
				return "", err
			}
			return prefix + "*", nil
		}
		if _, err := shared.NewCallsign(v); err != nil {
			return "", err
		}
		return strings.TrimRight(v, " "), nil
	case CriterionICAO24:
		id, err := shared.NewICAO24(v)
		return string(id), err
	case CriterionRegistration:
		id, err := shared.NewRegistration(v)
		return string(id), err
	case CriterionOperator, CriterionOrigin, CriterionDestination, CriterionArea, CriterionProtocol:
		if len(v) > 64 || strings.ContainsAny(v, "*/?\\") {
			return "", shared.NewDomainError(shared.ErrInvalidInput, "criterion value is too long or contains wildcard characters")
		}
		return v, nil
	default:
		return "", shared.NewDomainError(shared.ErrInvalidInput, "unknown criterion kind")
	}
}

type Candidate struct {
	Callsign          shared.Optional[shared.Callsign]
	ICAO24            shared.Optional[shared.ICAO24]
	Registration      shared.Optional[shared.Registration]
	Operator          shared.Optional[string]
	Origin            shared.Optional[string]
	Destination       shared.Optional[string]
	Areas             []string
	CountryCodes      shared.Optional[[]string]
	AltitudeMeters    shared.Optional[float64]
	Position          shared.Optional[geometry.GeoPoint]
	ObservedPath      []geometry.GeoPoint
	ObservedPathKnown bool
	RouteVia          []string
	RouteViaKnown     bool
	Protocols         []string
	ObservedAt        shared.Optional[shared.ObservationTime]
}

type MatchStatus string

const (
	Match   MatchStatus = "match"
	NoMatch MatchStatus = "no_match"
	Unknown MatchStatus = "unknown"
)

type CriterionEvidence struct {
	Criterion Criterion   `json:"criterion"`
	Outcome   MatchStatus `json:"outcome"`
	Reason    string      `json:"reason"`
}

type MatchResult struct {
	Status         MatchStatus         `json:"status"`
	Evidence       []CriterionEvidence `json:"evidence"`
	FilterEvidence []FilterEvidence    `json:"filterEvidence,omitempty"`
}

type FilterEvidence struct {
	Filter  string      `json:"filter"`
	Outcome MatchStatus `json:"outcome"`
	Reason  string      `json:"reason"`
}

// MatchWatchCriteria evaluates only supplied candidate data. Missing candidate
// fields produce UNKNOWN and never trigger a source fetch.
func MatchWatchCriteria(rule WatchRule, candidate Candidate) MatchResult {
	validated, err := NewWatchRule(rule)
	if err != nil {
		return MatchResult{Status: Unknown, Evidence: []CriterionEvidence{{Outcome: Unknown, Reason: "invalid_watch_rule: " + err.Error()}}}
	}
	if validated.Status != StatusActive {
		return MatchResult{Status: NoMatch, Evidence: []CriterionEvidence{{Outcome: NoMatch, Reason: "watch_rule_not_active"}}}
	}
	if validated.Window != nil {
		if !candidate.ObservedAt.Valid || candidate.ObservedAt.Value.Time.IsZero() {
			return MatchResult{Status: Unknown, Evidence: []CriterionEvidence{{Outcome: Unknown, Reason: "observation_time_missing_for_bounded_window"}}}
		}
		lo, hi := candidate.ObservedAt.Value.Bounds()
		if hi.Before(validated.Window.Start) || lo.After(validated.Window.End) {
			return MatchResult{Status: NoMatch, Evidence: []CriterionEvidence{{Outcome: NoMatch, Reason: "observation_outside_window"}}}
		}
		if lo.Before(validated.Window.Start) || hi.After(validated.Window.End) {
			return MatchResult{Status: Unknown, Evidence: []CriterionEvidence{{Outcome: Unknown, Reason: "observation_uncertainty_overlaps_window_boundary"}}}
		}
	}
	result := MatchResult{Status: Match}
	if validated.Scope == ScopeAreaDiscovery {
		e := evaluate(Criterion{Kind: CriterionArea, Value: strings.ToUpper(validated.Discovery.AreaID)}, candidate)
		result.Evidence = append(result.Evidence, e)
		if e.Outcome != Match {
			return MatchResult{Status: e.Outcome, Evidence: result.Evidence}
		}
	}
	for _, group := range validated.Groups {
		matches, nonMatches, unknowns := 0, 0, 0
		for _, criterion := range group.Criteria {
			e := evaluate(criterion, candidate)
			result.Evidence = append(result.Evidence, e)
			switch e.Outcome {
			case Match:
				matches++
			case NoMatch:
				nonMatches++
			case Unknown:
				unknowns++
			}
		}
		groupMatch := group.Mode == GroupAny && matches > 0 || group.Mode == GroupAll && nonMatches == 0 && unknowns == 0
		groupFail := group.Mode == GroupAny && matches == 0 && nonMatches > 0 && unknowns == 0 || group.Mode == GroupAll && nonMatches > 0
		if groupFail {
			result.Status = NoMatch
		} else if !groupMatch && result.Status != NoMatch {
			result.Status = Unknown
		}
	}
	if validated.Filters != nil {
		for _, evidence := range evaluateAdvancedFilters(validated.Filters, candidate) {
			result.FilterEvidence = append(result.FilterEvidence, evidence)
			if evidence.Outcome == NoMatch {
				result.Status = NoMatch
			} else if evidence.Outcome == Unknown && result.Status != NoMatch {
				result.Status = Unknown
			}
		}
	}
	return result
}

func evaluateAdvancedFilters(filters *AdvancedFilters, candidate Candidate) []FilterEvidence {
	out := []FilterEvidence{}
	add := func(name string, known, matched bool) {
		evidence := FilterEvidence{Filter: name}
		if !known {
			evidence.Outcome = Unknown
			evidence.Reason = "candidate evidence unavailable"
		} else if matched {
			evidence.Outcome = Match
			evidence.Reason = "candidate evidence satisfies filter"
		} else {
			evidence.Outcome = NoMatch
			evidence.Reason = "candidate evidence falls outside filter"
		}
		out = append(out, evidence)
	}
	if len(filters.CountryCodes) > 0 {
		known := candidate.CountryCodes.Valid
		matched := false
		if known {
			for _, want := range filters.CountryCodes {
				if _, ok := findFold(candidate.CountryCodes.Value, want); ok {
					matched = true
					break
				}
			}
		}
		add("countryCodes", known, matched)
	}
	if r := filters.AltitudeMeters; r != nil {
		known := candidate.AltitudeMeters.Valid
		matched := false
		if known {
			value := candidate.AltitudeMeters.Value
			matched = (r.Min == nil || value >= *r.Min) && (r.Max == nil || value <= *r.Max)
		}
		add("altitudeMeters", known, matched)
	}
	if route := filters.Route; route != nil {
		if route.Origin != "" {
			add("route.origin", candidate.Origin.Valid, candidate.Origin.Valid && strings.EqualFold(candidate.Origin.Value, route.Origin))
		}
		if route.Destination != "" {
			add("route.destination", candidate.Destination.Valid, candidate.Destination.Valid && strings.EqualFold(candidate.Destination.Value, route.Destination))
		}
		if len(route.Via) > 0 {
			matched := candidate.RouteViaKnown && containsOrdered(candidate.RouteVia, route.Via)
			add("route.via", candidate.RouteViaKnown, matched)
		}
	}
	if fence := filters.Geofence; fence != nil {
		area, err := polygonArea(fence)
		known := candidate.Position.Valid && err == nil
		matched := known && geometry.MatchArea(area, shared.Some(candidate.Position.Value)) == geometry.SpatialInside
		add("geofence", known, matched)
	}
	if path := filters.FlightPath; path != nil {
		area, err := pathArea(path)
		known := candidate.ObservedPathKnown && err == nil
		matched := false
		if known {
			for _, point := range candidate.ObservedPath {
				if geometry.MatchArea(area, shared.Some(point)) == geometry.SpatialInside {
					matched = true
					break
				}
			}
		}
		add("flightPath", known, matched)
	}
	return out
}

func containsOrdered(actual, expected []string) bool {
	at := 0
	for _, value := range actual {
		if at < len(expected) && strings.EqualFold(value, expected[at]) {
			at++
		}
	}
	return at == len(expected)
}

func evaluate(c Criterion, candidate Candidate) CriterionEvidence {
	e := CriterionEvidence{Criterion: c}
	known := true
	var actual string
	switch c.Kind {
	case CriterionCallsign:
		if candidate.Callsign.Valid {
			actual = string(candidate.Callsign.Value)
		} else {
			known = false
		}
	case CriterionICAO24:
		if candidate.ICAO24.Valid {
			actual = string(candidate.ICAO24.Value)
		} else {
			known = false
		}
	case CriterionRegistration:
		if candidate.Registration.Valid {
			actual = string(candidate.Registration.Value)
		} else {
			known = false
		}
	case CriterionOperator:
		if candidate.Operator.Valid {
			actual = candidate.Operator.Value
		} else {
			known = false
		}
	case CriterionOrigin:
		if candidate.Origin.Valid {
			actual = candidate.Origin.Value
		} else {
			known = false
		}
	case CriterionDestination:
		if candidate.Destination.Valid {
			actual = candidate.Destination.Value
		} else {
			known = false
		}
	case CriterionArea:
		actual, known = findFold(candidate.Areas, c.Value)
	case CriterionProtocol:
		actual, known = findFold(candidate.Protocols, c.Value)
	}
	if !known {
		e.Outcome = Unknown
		e.Reason = "candidate_value_unobserved"
		return e
	}
	matched := strings.EqualFold(actual, c.Value)
	if c.Kind == CriterionCallsign && strings.HasSuffix(c.Value, "*") {
		matched = strings.HasPrefix(strings.ToUpper(actual), strings.TrimSuffix(c.Value, "*"))
	}
	if matched {
		e.Outcome = Match
		e.Reason = "candidate_value_matches"
	} else {
		e.Outcome = NoMatch
		e.Reason = "candidate_value_differs"
	}
	return e
}

func findFold(values []string, expected string) (string, bool) {
	if len(values) == 0 {
		return "", false
	}
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), expected) {
			return value, true
		}
	}
	return "", true
}
