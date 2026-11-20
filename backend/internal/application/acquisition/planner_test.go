package acquisition

import (
	"fmt"
	"testing"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/application/watchlist"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/watch"
	"github.com/ppotepa/terminal-velocity/backend/internal/ports/sources"
)

func testCapabilities() sources.Capabilities {
	return sources.Capabilities{
		ID: "fixture", Lookups: []sources.LookupKind{sources.LookupICAO24, sources.LookupCallsign, sources.LookupRegistration, sources.LookupArea},
		RequestsPerWindow: 100, QuotaWindow: time.Minute, MinimumInterval: time.Second,
		RequestTimeout: 5 * time.Second, MaxResultsPerRequest: 500, MaxCandidatesPerArea: 100,
		SupportsCallsignPrefix: true,
	}
}

func targetedRule(id string, criteria ...watch.Criterion) watchlist.StoredRule {
	return watchlist.StoredRule{Rule: watch.WatchRule{
		ID: shared.WatchRuleID(id), Name: id, Status: watch.StatusActive, Scope: watch.ScopeTargeted,
		Groups:     []watch.CriteriaGroup{{Mode: watch.GroupAny, Criteria: criteria}},
		Collection: watch.CollectionPreferences{Positions: true},
	}}
}

func TestPlannerDeduplicatesTargetsAndKeepsCallsignPrefixSemantics(t *testing.T) {
	rules := []watchlist.StoredRule{
		targetedRule("rule-a", watch.Criterion{Kind: watch.CriterionICAO24, Value: "A1B2C3"}, watch.Criterion{Kind: watch.CriterionCallsign, Value: "UAL*"}),
		targetedRule("rule-b", watch.Criterion{Kind: watch.CriterionICAO24, Value: "A1B2C3"}, watch.Criterion{Kind: watch.CriterionRegistration, Value: "N123AB"}),
		{Rule: watch.WatchRule{ID: "paused", Status: watch.StatusPaused}},
	}
	plan, err := (QueryPlanner{}).Plan(rules, []sources.Capabilities{testCapabilities()})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Requests) != 3 || len(plan.Rejections) != 0 {
		t.Fatalf("requests=%+v rejections=%+v", plan.Requests, plan.Rejections)
	}
	var foundShared, foundPrefix bool
	for _, request := range plan.Requests {
		if request.Lookup == sources.LookupICAO24 {
			foundShared = len(request.RuleIDs) == 2 && request.RuleIDs[0] == "rule-a" && request.RuleIDs[1] == "rule-b"
		}
		if request.Lookup == sources.LookupCallsign {
			foundPrefix = request.Prefix && request.Value == "UAL"
		}
		if request.CandidateLimit != 500 || request.PollInterval != time.Second {
			t.Fatalf("source bounds not propagated: %+v", request)
		}
	}
	if !foundShared || !foundPrefix {
		t.Fatalf("missing deduplicated target or prefix query: %+v", plan.Requests)
	}
}

func TestPlannerAreaDiscoverySharesTheTightestBound(t *testing.T) {
	areaRule := func(id string, limit int) watchlist.StoredRule {
		return watchlist.StoredRule{Rule: watch.WatchRule{
			ID: shared.WatchRuleID(id), Name: id, Status: watch.StatusActive, Scope: watch.ScopeAreaDiscovery,
			Discovery:  &watch.DiscoveryBounds{AreaID: "de", MaxCandidates: limit},
			Collection: watch.CollectionPreferences{Positions: true},
		}}
	}
	plan, err := (QueryPlanner{}).Plan([]watchlist.StoredRule{areaRule("a", 10), areaRule("b", 5)}, []sources.Capabilities{testCapabilities()})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Requests) != 1 || plan.Requests[0].Lookup != sources.LookupArea || plan.Requests[0].AreaID != "DE" || plan.Requests[0].CandidateLimit != 5 || len(plan.Requests[0].RuleIDs) != 2 {
		t.Fatalf("area request is not deduplicated and tightly bounded: %+v", plan)
	}
}

func TestPlannerRejectsUnsupportedBroadAndUnboundedSources(t *testing.T) {
	broad := targetedRule("broad", watch.Criterion{Kind: watch.CriterionOperator, Value: "EXAMPLE AIR"})
	capability := testCapabilities()
	capability.SupportsCallsignPrefix = false
	prefix := targetedRule("prefix", watch.Criterion{Kind: watch.CriterionCallsign, Value: "UAL*"})
	plan, err := (QueryPlanner{}).Plan([]watchlist.StoredRule{broad, prefix}, []sources.Capabilities{capability})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Requests) != 0 || len(plan.Rejections) != 2 {
		t.Fatalf("unsupported rules were not surfaced: %+v", plan)
	}
	for _, rejection := range plan.Rejections {
		if rejection.Reason != "no_capable_source" {
			t.Fatalf("unexpected rejection: %+v", rejection)
		}
	}
	if _, err := (QueryPlanner{}).Plan(nil, []sources.Capabilities{{ID: "invalid"}}); err == nil {
		t.Fatal("accepted source without quota/time bounds")
	}
}

func TestPlannerReturnsNoRequestsForAnEmptyWatchlist(t *testing.T) {
	plan, err := (QueryPlanner{}).Plan(nil, []sources.Capabilities{testCapabilities()})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Requests) != 0 || len(plan.Rejections) != 0 {
		t.Fatalf("empty watchlist produced work: %+v", plan)
	}
}

func TestPlannerCapsTotalCycleRequests(t *testing.T) {
	capability := testCapabilities()
	capability.RequestsPerWindow = MaxQueriesPerPlan + 1
	rules := make([]watchlist.StoredRule, 0, MaxQueriesPerPlan/MaxQueriesPerRule+1)
	nextTarget := 1
	for ruleIndex := 0; ruleIndex < MaxQueriesPerPlan/MaxQueriesPerRule+1; ruleIndex++ {
		criteria := make([]watch.Criterion, 0, MaxQueriesPerRule)
		for range MaxQueriesPerRule {
			criteria = append(criteria, watch.Criterion{Kind: watch.CriterionICAO24, Value: fmt.Sprintf("%06X", nextTarget)})
			nextTarget++
		}
		rules = append(rules, targetedRule(fmt.Sprintf("rule-%03d", ruleIndex), criteria...))
	}
	plan, err := (QueryPlanner{}).Plan(rules, []sources.Capabilities{capability})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Requests) != MaxQueriesPerPlan {
		t.Fatalf("request count = %d, want cap %d", len(plan.Requests), MaxQueriesPerPlan)
	}
	found := false
	for _, rejection := range plan.Rejections {
		if rejection.Reason == "plan_limit_exceeded" {
			found = true
		}
	}
	if !found {
		t.Fatalf("global plan limit was not reported: %+v", plan.Rejections)
	}
}

func TestPlannerMakesQuotaRejectionsVisibleAndCapsRuleExpansion(t *testing.T) {
	capability := testCapabilities()
	capability.RequestsPerWindow = 1
	one := targetedRule("one", watch.Criterion{Kind: watch.CriterionICAO24, Value: "A1B2C3"})
	two := targetedRule("two", watch.Criterion{Kind: watch.CriterionICAO24, Value: "B2C3D4"})
	plan, err := (QueryPlanner{}).Plan([]watchlist.StoredRule{one, two}, []sources.Capabilities{capability})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Requests) != 1 || len(plan.Rejections) != 1 || plan.Rejections[0].Reason != "source_quota_exceeded" {
		t.Fatalf("quota limit not visible: %+v", plan)
	}

	capability.RequestsPerWindow = MaxQueriesPerRule + 1
	criteria := make([]watch.Criterion, 0, MaxQueriesPerRule+1)
	for i := 0; i < MaxQueriesPerRule+1; i++ {
		criteria = append(criteria, watch.Criterion{Kind: watch.CriterionICAO24, Value: fmt.Sprintf("%06X", i+1)})
	}
	large := targetedRule("large", criteria...)
	plan, err = (QueryPlanner{}).Plan([]watchlist.StoredRule{large}, []sources.Capabilities{capability})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Requests) != MaxQueriesPerRule || len(plan.Rejections) != 1 || plan.Rejections[0].Reason != "query_limit_exceeded" {
		t.Fatalf("per-rule query expansion not bounded: requests=%d rejections=%+v", len(plan.Requests), plan.Rejections)
	}
}
