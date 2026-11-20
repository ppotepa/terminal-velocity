package watch

import (
	"testing"
	"time"

	geometry "github.com/ppotepa/terminal-velocity/backend/internal/core/geography"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

func baseRule() WatchRule {
	return WatchRule{ID: "watch-1", Name: "Regional traffic", Groups: []CriteriaGroup{{Mode: GroupAny, Criteria: []Criterion{{Kind: CriterionICAO24, Value: "a1b2c3"}, {Kind: CriterionCallsign, Value: "UAL*"}}}, {Mode: GroupAll, Criteria: []Criterion{{Kind: CriterionProtocol, Value: "ACARS"}}}}, Collection: CollectionPreferences{Positions: true, Messages: true, DecoderIDs: []string{"decoder-1"}}}
}

func TestNewWatchRuleValidatesAndNormalizes(t *testing.T) {
	rule, err := NewWatchRule(baseRule())
	if err != nil {
		t.Fatal(err)
	}
	if rule.Status != StatusActive || rule.Scope != ScopeTargeted || rule.Groups[0].Criteria[0].Value != "A1B2C3" {
		t.Fatalf("defaults/normalization missing: %+v", rule)
	}
	bad := baseRule()
	bad.Groups[0].Criteria[1].Value = "*UAL"
	if _, err := NewWatchRule(bad); err == nil {
		t.Fatal("accepted leading callsign wildcard")
	}
	bad = baseRule()
	bad.Scope = ScopeAreaDiscovery
	bad.Groups = nil
	if _, err := NewWatchRule(bad); err == nil {
		t.Fatal("accepted unbounded area discovery")
	}
	bad = baseRule()
	bad.Discovery = &DiscoveryBounds{AreaID: "de", MaxCandidates: 2}
	if _, err := NewWatchRule(bad); err == nil {
		t.Fatal("accepted discovery bounds for targeted monitoring")
	}
}

func TestMatchAnyWithinGroupAndAllAcrossGroups(t *testing.T) {
	rule, err := NewWatchRule(baseRule())
	if err != nil {
		t.Fatal(err)
	}
	candidate := Candidate{Callsign: shared.Some(shared.Callsign("UAL52")), Protocols: []string{"acars"}}
	if got := MatchWatchCriteria(rule, candidate); got.Status != Match {
		t.Fatalf("expected match, got %+v", got)
	}
	candidate.Protocols = []string{"VDL2"}
	if got := MatchWatchCriteria(rule, candidate); got.Status != NoMatch {
		t.Fatalf("AND group should fail, got %+v", got)
	}
}

func TestMissingAndConflictingEvidenceRemainsExplicit(t *testing.T) {
	rule := WatchRule{ID: "watch-1", Name: "one target", Groups: []CriteriaGroup{{Mode: GroupAny, Criteria: []Criterion{{Kind: CriterionICAO24, Value: "A1B2C3"}, {Kind: CriterionCallsign, Value: "UAL*"}}}}, Collection: CollectionPreferences{Positions: true}}
	if got := MatchWatchCriteria(rule, Candidate{}); got.Status != Unknown {
		t.Fatalf("missing fields must be unknown: %+v", got)
	}
	candidate := Candidate{ICAO24: shared.Some(shared.ICAO24("FFFFFF")), Callsign: shared.Some(shared.Callsign("UAL7"))}
	if got := MatchWatchCriteria(rule, candidate); got.Status != Match {
		t.Fatalf("any matching criterion should match: %+v", got)
	}
	rule.Groups[0].Mode = GroupAll
	if got := MatchWatchCriteria(rule, candidate); got.Status != NoMatch {
		t.Fatalf("conflicting identity criteria should not confirm: %+v", got)
	}
}

func TestTimeBoundsRespectUncertainty(t *testing.T) {
	start := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	rule := WatchRule{ID: "watch-1", Name: "window", Groups: []CriteriaGroup{{Mode: GroupAll, Criteria: []Criterion{{Kind: CriterionProtocol, Value: "ACARS"}}}}, Window: &Window{Start: start, End: start.Add(time.Hour)}, Collection: CollectionPreferences{Messages: true}}
	candidate := Candidate{Protocols: []string{"ACARS"}, ObservedAt: shared.Some(shared.ObservationTime{Time: start.Add(-time.Second), Uncertainty: 2 * time.Second})}
	if got := MatchWatchCriteria(rule, candidate); got.Status != Unknown {
		t.Fatalf("overlapping uncertainty should be unknown: %+v", got)
	}
	candidate.ObservedAt = shared.Some(shared.ObservationTime{Time: start.Add(-10 * time.Second), Uncertainty: time.Second})
	if got := MatchWatchCriteria(rule, candidate); got.Status != NoMatch {
		t.Fatalf("outside window should not match: %+v", got)
	}
}

func TestAreaDiscoveryRequiresHardBounds(t *testing.T) {
	rule := WatchRule{ID: "watch-1", Name: "area", Scope: ScopeAreaDiscovery, Discovery: &DiscoveryBounds{AreaID: "de", MaxCandidates: 50}, Collection: CollectionPreferences{Positions: true}}
	if _, err := NewWatchRule(rule); err != nil {
		t.Fatal(err)
	}
	rule.Discovery.MaxCandidates = 1001
	if _, err := NewWatchRule(rule); err == nil {
		t.Fatal("accepted excessive candidate bound")
	}
}

func TestAreaDiscoveryMatcherStaysInsideConfiguredArea(t *testing.T) {
	rule := WatchRule{ID: "watch-1", Name: "area", Scope: ScopeAreaDiscovery, Discovery: &DiscoveryBounds{AreaID: "de", MaxCandidates: 50}, Collection: CollectionPreferences{Positions: true}}
	if got := MatchWatchCriteria(rule, Candidate{}); got.Status != Unknown {
		t.Fatalf("missing area evidence must be unknown: %+v", got)
	}
	if got := MatchWatchCriteria(rule, Candidate{Areas: []string{"FR"}}); got.Status != NoMatch {
		t.Fatalf("outside discovery area must not match: %+v", got)
	}
	if got := MatchWatchCriteria(rule, Candidate{Areas: []string{"DE"}}); got.Status != Match {
		t.Fatalf("inside discovery area should match: %+v", got)
	}
}

func TestCollectionPreferencesMustBeActionable(t *testing.T) {
	rule := WatchRule{ID: "watch-1", Name: "empty", Groups: []CriteriaGroup{{Mode: GroupAll, Criteria: []Criterion{{Kind: CriterionProtocol, Value: "ACARS"}}}}}
	if _, err := NewWatchRule(rule); err == nil {
		t.Fatal("accepted rule with no collection preferences")
	}
	rule.Collection.Positions = true
	rule.Collection.DecoderIDs = []string{"decoder-1"}
	if _, err := NewWatchRule(rule); err == nil {
		t.Fatal("accepted decoder selection without message collection")
	}
}

func TestAdvancedFiltersValidateAndMatchEvidence(t *testing.T) {
	minAltitude, maxAltitude := 9000.0, 11000.0
	rule := WatchRule{ID: "watch-1", Name: "route filters", Scope: ScopeTargeted, Groups: []CriteriaGroup{{Mode: GroupAny, Criteria: []Criterion{{Kind: CriterionCallsign, Value: "UAL52"}}}}, Collection: CollectionPreferences{Positions: true}, Filters: &AdvancedFilters{
		CountryCodes: []string{"fr"}, AltitudeMeters: &AltitudeRange{Min: &minAltitude, Max: &maxAltitude}, Route: &FlightRoute{Origin: "lhr", Destination: "cdg", Via: []string{"dov"}},
		Geofence:   &GeoJSONPolygon{Type: "Polygon", Coordinates: [][]GeoJSONPosition{{{-1, 48}, {5, 48}, {5, 52}, {-1, 52}, {-1, 48}}}},
		FlightPath: &FlightPathCorridor{Type: "LineString", Coordinates: []GeoJSONPosition{{-0.1, 51.5}, {2.35, 48.85}}, WidthMeters: 50000},
	}}
	validated, err := NewWatchRule(rule)
	if err != nil {
		t.Fatal(err)
	}
	if validated.Filters.Route.Origin != "LHR" || validated.Filters.CountryCodes[0] != "FR" {
		t.Fatalf("filters were not normalized: %+v", validated.Filters)
	}
	candidate := Candidate{Callsign: shared.Some(shared.Callsign("UAL52")), CountryCodes: shared.Some([]string{"FR"}), AltitudeMeters: shared.Some(9800.0), Position: shared.Some(geometry.GeoPoint{Latitude: 48.85, Longitude: 2.35}), Origin: shared.Some("LHR"), Destination: shared.Some("CDG"), RouteVia: []string{"DOV"}, RouteViaKnown: true, ObservedPath: []geometry.GeoPoint{{Latitude: 51.5, Longitude: -0.1}, {Latitude: 48.85, Longitude: 2.35}}, ObservedPathKnown: true}
	if got := MatchWatchCriteria(validated, candidate); got.Status != Match {
		t.Fatalf("expected complete advanced-filter match: %+v", got)
	}
	candidate.AltitudeMeters = shared.Some(12000.0)
	if got := MatchWatchCriteria(validated, candidate); got.Status != NoMatch {
		t.Fatalf("altitude outside bounds must not match: %+v", got)
	}
	candidate.AltitudeMeters = shared.None[float64]()
	if got := MatchWatchCriteria(validated, candidate); got.Status != Unknown {
		t.Fatalf("missing altitude must remain unknown: %+v", got)
	}
}

func TestAdvancedFiltersRejectUnsafeGeometryAndRanges(t *testing.T) {
	min, max := 12000.0, 9000.0
	for _, filters := range []*AdvancedFilters{{AltitudeMeters: &AltitudeRange{Min: &min, Max: &max}}, {Geofence: &GeoJSONPolygon{Type: "Polygon", Coordinates: [][]GeoJSONPosition{{{0, 0}, {0, 1}, {1, 1}, {1, 0}}}}}, {FlightPath: &FlightPathCorridor{Type: "LineString", Coordinates: []GeoJSONPosition{{0, 0}, {1, 1}}, WidthMeters: 100001}}} {
		rule := baseRule()
		rule.Filters = filters
		if _, err := NewWatchRule(rule); err == nil {
			t.Fatalf("accepted invalid filters: %+v", filters)
		}
	}
}
