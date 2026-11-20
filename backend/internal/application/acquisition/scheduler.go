package acquisition

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/application/watchlist"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/watch"
	"github.com/ppotepa/terminal-velocity/backend/internal/ports/sources"
)

const (
	defaultRulePageSize = 1000
	defaultMaxRuleCount = 10000
)

type EnabledRuleLister interface {
	ListEnabled(context.Context, string, int) ([]watchlist.StoredRule, string, error)
	Get(context.Context, shared.WatchRuleID) (watchlist.StoredRule, error)
}

type Consumer func(context.Context, sources.Query, sources.FetchResult) error

type QueryOutcome struct {
	QueryKey    string
	SourceID    string
	RecordCount int
	Skipped     bool
	Error       string
}

type CycleReport struct {
	Plan     PlanResult
	Outcomes []QueryOutcome
}

type Scheduler struct {
	Rules        EnabledRuleLister
	Sources      []sources.Source
	Checkpoints  sources.CheckpointStore
	Consume      Consumer
	Planner      QueryPlanner
	Budget       *RateBudget
	PollInterval time.Duration
	PageSize     int
	MaxRuleCount int
	MaxRetries   int
	Backoff      func(int) time.Duration
	pauseMu      sync.Mutex
	paused       bool
	resumeCh     chan struct{}
}

// Pause prevents new source requests. A request already in progress is allowed to
// finish; the next query or retry waits until Resume or context cancellation.
func (s *Scheduler) Pause() {
	s.pauseMu.Lock()
	defer s.pauseMu.Unlock()
	if !s.paused {
		s.paused = true
		s.resumeCh = make(chan struct{})
	}
}

func (s *Scheduler) Resume() {
	s.pauseMu.Lock()
	defer s.pauseMu.Unlock()
	if s.paused {
		s.paused = false
		close(s.resumeCh)
		s.resumeCh = nil
	}
}

func (s *Scheduler) waitUntilResumed(ctx context.Context) error {
	s.pauseMu.Lock()
	paused, resume := s.paused, s.resumeCh
	s.pauseMu.Unlock()
	if !paused {
		return ctx.Err()
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-resume:
		return nil
	}
}

func NewScheduler(rules EnabledRuleLister, clients []sources.Source, checkpoints sources.CheckpointStore, consume Consumer, pollInterval time.Duration) *Scheduler {
	return &Scheduler{
		Rules: rules, Sources: clients, Checkpoints: checkpoints, Consume: consume,
		Planner: QueryPlanner{}, Budget: NewRateBudget(), PollInterval: pollInterval,
		PageSize: defaultRulePageSize, MaxRuleCount: defaultMaxRuleCount, MaxRetries: 2,
		Backoff: exponentialBackoff,
	}
}

// Run polls enabled rules on a bounded interval. Cancellation stops the timer and
// is propagated through in-flight provider calls, retry waits and checkpoint I/O.
func (s *Scheduler) Run(ctx context.Context) error {
	if s.PollInterval <= 0 {
		return errors.New("scheduler poll interval must be positive")
	}
	for {
		if _, err := s.RunOnce(ctx); err != nil {
			return err
		}
		timer := time.NewTimer(s.PollInterval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

// RunOnce plans current enabled rules and executes each bounded source request.
func (s *Scheduler) RunOnce(ctx context.Context) (CycleReport, error) {
	if s.Rules == nil || s.Checkpoints == nil || s.Consume == nil {
		return CycleReport{}, errors.New("scheduler requires rule, checkpoint and consumer dependencies")
	}
	if s.Budget == nil {
		s.Budget = NewRateBudget()
	}
	rules, err := s.loadRules(ctx)
	if err != nil {
		return CycleReport{}, err
	}
	clients := make(map[string]sources.Source, len(s.Sources))
	capabilities := make([]sources.Capabilities, 0, len(s.Sources))
	for _, client := range s.Sources {
		if client == nil {
			return CycleReport{}, errors.New("scheduler contains a nil source")
		}
		capability := client.Capabilities()
		if _, exists := clients[capability.ID]; exists {
			return CycleReport{}, fmt.Errorf("duplicate source client %q", capability.ID)
		}
		clients[capability.ID] = client
		capabilities = append(capabilities, capability)
	}
	plan, err := s.Planner.Plan(rules, capabilities)
	if err != nil {
		return CycleReport{}, err
	}
	report := CycleReport{Plan: plan, Outcomes: make([]QueryOutcome, 0, len(plan.Requests))}
	for _, query := range plan.Requests {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		if err := s.waitUntilResumed(ctx); err != nil {
			return report, err
		}
		current, active, err := s.currentQuery(ctx, query, capabilities)
		if err != nil {
			return report, err
		}
		if !active {
			report.Outcomes = append(report.Outcomes, QueryOutcome{QueryKey: query.Key, SourceID: query.SourceID, Skipped: true})
			continue
		}
		query = current
		checkpoint, exists, err := s.Checkpoints.Load(ctx, query.SourceID, query.Key)
		if err != nil {
			report.Outcomes = append(report.Outcomes, QueryOutcome{QueryKey: query.Key, SourceID: query.SourceID, Error: "checkpoint load failed"})
			continue
		}
		if exists {
			query.SinceToken = checkpoint.Token
		}
		client := clients[query.SourceID]
		capability := client.Capabilities()
		result, fetchErr := s.fetchWithRetry(ctx, client, capability, query)
		if fetchErr != nil {
			if ctx.Err() != nil {
				return report, ctx.Err()
			}
			report.Outcomes = append(report.Outcomes, QueryOutcome{QueryKey: query.Key, SourceID: query.SourceID, Error: "source request failed after bounded retries"})
			continue
		}
		if err := s.Consume(ctx, query, result); err != nil {
			report.Outcomes = append(report.Outcomes, QueryOutcome{QueryKey: query.Key, SourceID: query.SourceID, Error: "source result processing failed"})
			continue
		}
		if result.CheckpointToken != "" {
			if err := s.Checkpoints.Save(ctx, sources.Checkpoint{SourceID: query.SourceID, QueryKey: query.Key, Token: result.CheckpointToken, UpdatedAt: time.Now().UTC()}); err != nil {
				report.Outcomes = append(report.Outcomes, QueryOutcome{QueryKey: query.Key, SourceID: query.SourceID, Error: "checkpoint save failed"})
				continue
			}
		}
		report.Outcomes = append(report.Outcomes, QueryOutcome{QueryKey: query.Key, SourceID: query.SourceID, RecordCount: len(result.Records)})
	}
	return report, nil
}

func (s *Scheduler) loadRules(ctx context.Context) ([]watchlist.StoredRule, error) {
	pageSize := s.PageSize
	if pageSize <= 0 || pageSize > watchlist.MaxEnabledPageSize {
		pageSize = defaultRulePageSize
	}
	maximum := s.MaxRuleCount
	if maximum <= 0 {
		maximum = defaultMaxRuleCount
	}
	items := make([]watchlist.StoredRule, 0)
	cursor := ""
	for {
		page, next, err := s.Rules.ListEnabled(ctx, cursor, pageSize)
		if err != nil {
			return nil, err
		}
		items = append(items, page...)
		if len(items) > maximum {
			return nil, fmt.Errorf("enabled rule set exceeds scheduler limit of %d", maximum)
		}
		if next == "" {
			return items, nil
		}
		if len(page) == 0 {
			return nil, errors.New("enabled rule cursor advanced without returning records")
		}
		if next == cursor {
			return nil, errors.New("enabled rule cursor did not advance")
		}
		cursor = next
	}
}

func (s *Scheduler) currentQuery(ctx context.Context, planned sources.Query, capabilities []sources.Capabilities) (sources.Query, bool, error) {
	activeRules := make([]string, 0, len(planned.RuleIDs))
	for _, rawID := range planned.RuleIDs {
		stored, err := s.Rules.Get(ctx, shared.WatchRuleID(rawID))
		if errors.Is(err, watchlist.ErrNotFound) || (err == nil && stored.Rule.Status != watch.StatusActive) {
			continue
		}
		if err != nil {
			return sources.Query{}, false, err
		}
		fresh, err := s.Planner.Plan([]watchlist.StoredRule{stored}, capabilities)
		if err != nil {
			return sources.Query{}, false, err
		}
		for _, candidate := range fresh.Requests {
			if candidate.Key == planned.Key {
				activeRules = append(activeRules, rawID)
				if candidate.CandidateLimit < planned.CandidateLimit {
					planned.CandidateLimit = candidate.CandidateLimit
				}
				break
			}
		}
	}
	if len(activeRules) > 0 {
		planned.RuleIDs = activeRules
		return planned, true, nil
	}
	return planned, false, nil
}

func (s *Scheduler) fetchWithRetry(ctx context.Context, client sources.Source, capability sources.Capabilities, query sources.Query) (sources.FetchResult, error) {
	maxRetries := max(0, s.MaxRetries)
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if err := s.waitUntilResumed(ctx); err != nil {
			return sources.FetchResult{}, err
		}
		if err := s.Budget.Wait(ctx, capability); err != nil {
			return sources.FetchResult{}, err
		}
		if err := s.waitUntilResumed(ctx); err != nil {
			return sources.FetchResult{}, err
		}
		requestCtx, cancel := context.WithTimeout(ctx, capability.RequestTimeout)
		result, err := client.Fetch(requestCtx, query)
		cancel()
		if err == nil {
			return result, nil
		}
		if ctx.Err() != nil {
			return sources.FetchResult{}, ctx.Err()
		}
		if attempt == maxRetries {
			return sources.FetchResult{}, err
		}
		backoff := s.Backoff
		if backoff == nil {
			backoff = exponentialBackoff
		}
		if err := waitContext(ctx, backoff(attempt)); err != nil {
			return sources.FetchResult{}, err
		}
	}
	return sources.FetchResult{}, errors.New("source retries exhausted")
}

func exponentialBackoff(attempt int) time.Duration {
	if attempt < 0 {
		attempt = 0
	}
	delay := 100 * time.Millisecond * time.Duration(1<<min(attempt, 6))
	return min(delay, 5*time.Second)
}

func waitContext(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return ctx.Err()
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

type sourceBudgetState struct {
	windowStart time.Time
	lastRequest time.Time
	requests    int
}

// RateBudget enforces a per-source fixed-window quota and minimum sampling interval.
type RateBudget struct {
	mu     sync.Mutex
	states map[string]sourceBudgetState
	now    func() time.Time
}

func NewRateBudget() *RateBudget {
	return &RateBudget{states: make(map[string]sourceBudgetState), now: time.Now}
}

func (b *RateBudget) Wait(ctx context.Context, capability sources.Capabilities) error {
	if err := capability.Validate(); err != nil {
		return err
	}
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		b.mu.Lock()
		if b.states == nil {
			b.states = make(map[string]sourceBudgetState)
		}
		if b.now == nil {
			b.now = time.Now
		}
		now := b.now()
		state := b.states[capability.ID]
		if state.windowStart.IsZero() || !now.Before(state.windowStart.Add(capability.QuotaWindow)) {
			state.windowStart = now
			state.requests = 0
		}
		readyAt := state.lastRequest.Add(capability.MinimumInterval)
		if state.lastRequest.IsZero() {
			readyAt = now
		}
		if state.requests >= capability.RequestsPerWindow {
			windowEnd := state.windowStart.Add(capability.QuotaWindow)
			if windowEnd.After(readyAt) {
				readyAt = windowEnd
			}
		}
		if !readyAt.After(now) {
			state.requests++
			state.lastRequest = now
			b.states[capability.ID] = state
			b.mu.Unlock()
			return nil
		}
		b.states[capability.ID] = state
		b.mu.Unlock()
		timer := time.NewTimer(readyAt.Sub(now))
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}
