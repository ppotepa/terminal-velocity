package acquisition

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/application/watchlist"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/watch"
	"github.com/ppotepa/terminal-velocity/backend/internal/ports/sources"
)

type fakeRules struct {
	mu    sync.Mutex
	items map[shared.WatchRuleID]watchlist.StoredRule
}

func newFakeRules(items ...watchlist.StoredRule) *fakeRules {
	result := &fakeRules{items: make(map[shared.WatchRuleID]watchlist.StoredRule)}
	for _, item := range items {
		result.items[item.Rule.ID] = item
	}
	return result
}

func (r *fakeRules) ListEnabled(_ context.Context, after string, limit int) ([]watchlist.StoredRule, string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := make([]watchlist.StoredRule, 0, len(r.items))
	for _, item := range r.items {
		if item.Rule.Status == watch.StatusActive && string(item.Rule.ID) > after {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Rule.ID < items[j].Rule.ID })
	if len(items) <= limit {
		return items, "", nil
	}
	return items[:limit], string(items[limit-1].Rule.ID), nil
}

func (r *fakeRules) Get(_ context.Context, id shared.WatchRuleID) (watchlist.StoredRule, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.items[id]
	if !ok {
		return watchlist.StoredRule{}, watchlist.ErrNotFound
	}
	return item, nil
}

func (r *fakeRules) setStatus(id shared.WatchRuleID, status watch.Status) {
	r.mu.Lock()
	defer r.mu.Unlock()
	item := r.items[id]
	item.Rule.Status = status
	r.items[id] = item
}

type fakeCheckpointStore struct {
	mu    sync.Mutex
	items map[string]sources.Checkpoint
}

func newFakeCheckpointStore() *fakeCheckpointStore {
	return &fakeCheckpointStore{items: make(map[string]sources.Checkpoint)}
}

func checkpointKey(sourceID, queryKey string) string { return sourceID + "\x00" + queryKey }

func (s *fakeCheckpointStore) Load(_ context.Context, sourceID, queryKey string) (sources.Checkpoint, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.items[checkpointKey(sourceID, queryKey)]
	return item, ok, nil
}

func (s *fakeCheckpointStore) Save(_ context.Context, item sources.Checkpoint) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[checkpointKey(item.SourceID, item.QueryKey)] = item
	return nil
}

type fakeSource struct {
	caps  sources.Capabilities
	fetch func(context.Context, sources.Query) (sources.FetchResult, error)
	mu    sync.Mutex
	seen  []sources.Query
}

func (s *fakeSource) Capabilities() sources.Capabilities { return s.caps }
func (s *fakeSource) Fetch(ctx context.Context, query sources.Query) (sources.FetchResult, error) {
	s.mu.Lock()
	s.seen = append(s.seen, query)
	s.mu.Unlock()
	return s.fetch(ctx, query)
}

func (s *fakeSource) queries() []sources.Query {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]sources.Query(nil), s.seen...)
}

func TestSchedulerRetriesAndPersistsPerTargetCheckpoint(t *testing.T) {
	rule := targetedRule("active", watch.Criterion{Kind: watch.CriterionICAO24, Value: "A1B2C3"})
	rules := newFakeRules(rule)
	checkpoints := newFakeCheckpointStore()
	var calls int
	client := &fakeSource{caps: testCapabilities()}
	client.caps.MinimumInterval = 0
	client.fetch = func(_ context.Context, _ sources.Query) (sources.FetchResult, error) {
		calls++
		if calls == 1 {
			return sources.FetchResult{}, errors.New("synthetic transient failure")
		}
		return sources.FetchResult{Records: []sources.Record{{Payload: []byte("synthetic")}}, CheckpointToken: fmt.Sprintf("token-%d", calls)}, nil
	}
	consumed := 0
	scheduler := NewScheduler(rules, []sources.Source{client}, checkpoints, func(_ context.Context, _ sources.Query, result sources.FetchResult) error {
		consumed += len(result.Records)
		return nil
	}, time.Second)
	scheduler.MaxRetries = 1
	scheduler.Backoff = func(int) time.Duration { return 0 }
	if _, err := scheduler.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls != 2 || consumed != 1 {
		t.Fatalf("calls=%d consumed=%d, want retry and one consumed result", calls, consumed)
	}
	if _, err := scheduler.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	queries := client.queries()
	if len(queries) != 3 || queries[2].SinceToken != "token-2" {
		t.Fatalf("checkpoint was not passed to the next request: %+v", queries)
	}
}

func TestSchedulerRechecksRulesBeforeFutureRequests(t *testing.T) {
	rule := targetedRule("active", watch.Criterion{Kind: watch.CriterionICAO24, Value: "A1B2C3"}, watch.Criterion{Kind: watch.CriterionRegistration, Value: "N123AB"})
	other := targetedRule("other", watch.Criterion{Kind: watch.CriterionICAO24, Value: "B2C3D4"})
	rules := newFakeRules(rule, other)
	client := &fakeSource{caps: testCapabilities(), fetch: func(context.Context, sources.Query) (sources.FetchResult, error) {
		return sources.FetchResult{Records: []sources.Record{{Payload: []byte("synthetic")}}}, nil
	}}
	scheduler := NewScheduler(rules, []sources.Source{client}, newFakeCheckpointStore(), func(context.Context, sources.Query, sources.FetchResult) error {
		rules.setStatus(rule.Rule.ID, watch.StatusPaused)
		return nil
	}, time.Second)
	scheduler.MaxRetries = 0
	report, err := scheduler.RunOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	queries := client.queries()
	activeOther, activePaused, skipped := 0, 0, 0
	for _, query := range queries {
		if len(query.RuleIDs) == 1 && query.RuleIDs[0] == string(other.Rule.ID) {
			activeOther++
		}
		if len(query.RuleIDs) == 1 && query.RuleIDs[0] == string(rule.Rule.ID) {
			activePaused++
		}
	}
	for _, outcome := range report.Outcomes {
		if outcome.Skipped {
			skipped++
		}
	}
	if len(report.Plan.Requests) != 3 || activeOther != 1 || activePaused > 1 || skipped == 0 {
		t.Fatalf("disabled rule retained future work: plan=%+v queries=%+v outcomes=%+v", report.Plan, queries, report.Outcomes)
	}
}

func TestSchedulerCancelsTimedOutSourceRequest(t *testing.T) {
	rule := targetedRule("active", watch.Criterion{Kind: watch.CriterionICAO24, Value: "A1B2C3"})
	client := &fakeSource{caps: testCapabilities(), fetch: func(ctx context.Context, _ sources.Query) (sources.FetchResult, error) {
		<-ctx.Done()
		return sources.FetchResult{}, ctx.Err()
	}}
	client.caps.RequestTimeout = 10 * time.Millisecond
	scheduler := NewScheduler(newFakeRules(rule), []sources.Source{client}, newFakeCheckpointStore(), func(context.Context, sources.Query, sources.FetchResult) error { return nil }, time.Second)
	scheduler.MaxRetries = 0
	report, err := scheduler.RunOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Outcomes) != 1 || report.Outcomes[0].Error == "" {
		t.Fatalf("timed out provider request not reported: %+v", report.Outcomes)
	}
}

func TestSchedulerPauseBlocksNewRequestsUntilResumed(t *testing.T) {
	rule := targetedRule("active", watch.Criterion{Kind: watch.CriterionICAO24, Value: "A1B2C3"})
	client := &fakeSource{caps: testCapabilities(), fetch: func(context.Context, sources.Query) (sources.FetchResult, error) {
		return sources.FetchResult{}, nil
	}}
	scheduler := NewScheduler(newFakeRules(rule), []sources.Source{client}, newFakeCheckpointStore(), func(context.Context, sources.Query, sources.FetchResult) error { return nil }, time.Second)
	scheduler.Pause()
	done := make(chan error, 1)
	go func() {
		_, err := scheduler.RunOnce(context.Background())
		done <- err
	}()
	select {
	case err := <-done:
		t.Fatalf("paused cycle completed early: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	if len(client.queries()) != 0 {
		t.Fatal("source received a request while scheduler was paused")
	}
	scheduler.Resume()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("scheduler did not resume")
	}
	if len(client.queries()) != 1 {
		t.Fatalf("request count after resume = %d, want 1", len(client.queries()))
	}
}

func TestSchedulerCancellationInterruptsPause(t *testing.T) {
	rule := targetedRule("active", watch.Criterion{Kind: watch.CriterionICAO24, Value: "A1B2C3"})
	client := &fakeSource{caps: testCapabilities(), fetch: func(context.Context, sources.Query) (sources.FetchResult, error) {
		return sources.FetchResult{}, nil
	}}
	scheduler := NewScheduler(newFakeRules(rule), []sources.Source{client}, newFakeCheckpointStore(), func(context.Context, sources.Query, sources.FetchResult) error { return nil }, time.Second)
	scheduler.Pause()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := scheduler.RunOnce(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("paused cycle error = %v, want deadline", err)
	}
	if len(client.queries()) != 0 {
		t.Fatal("source received a request after cancellation")
	}
}

func TestRateBudgetEnforcesWindowAndContextCancellation(t *testing.T) {
	capability := testCapabilities()
	capability.RequestsPerWindow = 1
	capability.QuotaWindow = 100 * time.Millisecond
	capability.MinimumInterval = 0
	budget := NewRateBudget()
	if err := budget.Wait(context.Background(), capability); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if err := budget.Wait(ctx, capability); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("budget wait error = %v, want deadline", err)
	}
}
