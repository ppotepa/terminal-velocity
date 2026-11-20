package api

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/application/acquisition"
	"github.com/ppotepa/terminal-velocity/backend/internal/application/watchlist"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/watch"
	"github.com/ppotepa/terminal-velocity/backend/internal/ports/sources"
)

type oneRule struct{ item watchlist.StoredRule }

func (r oneRule) ListEnabled(context.Context, string, int) ([]watchlist.StoredRule, string, error) {
	return []watchlist.StoredRule{r.item}, "", nil
}
func (r oneRule) Get(_ context.Context, id shared.WatchRuleID) (watchlist.StoredRule, error) {
	if id == r.item.Rule.ID {
		return r.item, nil
	}
	return watchlist.StoredRule{}, watchlist.ErrNotFound
}

type noCheckpoints struct{}

func (noCheckpoints) Load(context.Context, string, string) (sources.Checkpoint, bool, error) {
	return sources.Checkpoint{}, false, nil
}
func (noCheckpoints) Save(context.Context, sources.Checkpoint) error { return nil }

type workingFixtureSource struct {
	calls int
	mu    sync.Mutex
}

func (*workingFixtureSource) Capabilities() sources.Capabilities {
	return sources.Capabilities{ID: "fixture-provider", Lookups: []sources.LookupKind{sources.LookupICAO24}, RequestsPerWindow: 1, QuotaWindow: time.Minute, MinimumInterval: 0, RequestTimeout: time.Second, MaxResultsPerRequest: 10}
}
func (s *workingFixtureSource) Fetch(context.Context, sources.Query) (sources.FetchResult, error) {
	s.mu.Lock()
	s.calls++
	s.mu.Unlock()
	return sources.FetchResult{Records: []sources.Record{{ObservedAt: time.Now().UTC(), Payload: []byte("synthetic")}}}, nil
}

func TestDisabledAirframesSourceDoesNotStopOtherProviders(t *testing.T) {
	rule := watchlist.StoredRule{Rule: watch.WatchRule{ID: "rule-api-test", Name: "synthetic rule", Status: watch.StatusActive, Scope: watch.ScopeTargeted, Groups: []watch.CriteriaGroup{{Mode: watch.GroupAny, Criteria: []watch.Criterion{{Kind: watch.CriterionICAO24, Value: "A1B2C3"}}}}, Collection: watch.CollectionPreferences{Positions: true}}}
	apiSource := New(Config{Enabled: false})
	fixture := &workingFixtureSource{}
	consumed := 0
	scheduler := acquisition.NewScheduler(oneRule{item: rule}, []sources.Source{apiSource, fixture}, noCheckpoints{}, func(_ context.Context, q sources.Query, result sources.FetchResult) error {
		if q.SourceID == "fixture-provider" {
			consumed += len(result.Records)
		}
		return nil
	}, time.Minute)
	scheduler.MaxRetries = 0
	report, err := scheduler.RunOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if fixture.calls != 1 || consumed != 1 {
		t.Fatalf("other provider calls=%d consumed=%d", fixture.calls, consumed)
	}
	if len(report.Plan.Requests) != 2 || len(report.Outcomes) != 2 {
		t.Fatalf("scheduler report=%+v", report)
	}
	var apiFailed, fixtureSucceeded bool
	for _, outcome := range report.Outcomes {
		if outcome.SourceID == SourceID && outcome.Error != "" {
			apiFailed = true
		}
		if outcome.SourceID == "fixture-provider" && outcome.RecordCount == 1 {
			fixtureSucceeded = true
		}
	}
	if !apiFailed || !fixtureSucceeded {
		t.Fatalf("provider outcomes=%+v", report.Outcomes)
	}
}
