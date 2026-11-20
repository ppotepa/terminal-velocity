package watch

import (
	"testing"
	"time"

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
