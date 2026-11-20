package alerting

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/alerting"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

type memoryRepo struct {
	mu     sync.Mutex
	rules  map[shared.AlertID]StoredRule
	states map[string]StoredState
	events map[string]StoredEvent
}

func newMemoryRepo() *memoryRepo {
	return &memoryRepo{rules: map[shared.AlertID]StoredRule{}, states: map[string]StoredState{}, events: map[string]StoredEvent{}}
}
func stateKey(rule shared.AlertID, subject alerting.Subject) string {
	return fmt.Sprintf("%s/%s/%s", rule, subject.AircraftID.Value, subject.FlightID.Value)
}
func (r *memoryRepo) GetRule(_ context.Context, id shared.AlertID) (StoredRule, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	v, ok := r.rules[id]
	if !ok {
		return StoredRule{}, ErrNotFound
	}
	return v, nil
}
func (r *memoryRepo) SaveRule(_ context.Context, rule alerting.AlertRule, expected int64, now time.Time) (StoredRule, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	old, ok := r.rules[rule.ID]
	if expected == 0 {
		if ok {
			return StoredRule{}, ErrConflict
		}
		old = StoredRule{Rule: rule, Revision: 1, UpdatedAt: now}
	} else {
		if !ok {
			return StoredRule{}, ErrNotFound
		}
		if old.Revision != expected {
			return StoredRule{}, ErrConflict
		}
		old = StoredRule{Rule: rule, Revision: expected + 1, UpdatedAt: now}
	}
	r.rules[rule.ID] = old
	return old, nil
}
func (r *memoryRepo) ListRules(_ context.Context, after string, limit int) ([]StoredRule, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []StoredRule{}
	for id, v := range r.rules {
		if string(id) > after {
			out = append(out, v)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Rule.ID < out[j].Rule.ID })
	if len(out) > limit {
		return out[:limit], true, nil
	}
	return out, false, nil
}
func (r *memoryRepo) GetState(_ context.Context, rule shared.AlertID, subject alerting.Subject) (StoredState, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	v, ok := r.states[stateKey(rule, subject)]
	if !ok {
		return StoredState{}, ErrStateNotFound
	}
	return v, nil
}
func (r *memoryRepo) SaveState(_ context.Context, expected int64, v StoredState) (StoredState, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := stateKey(v.State.RuleID, v.State.Subject)
	old, ok := r.states[k]
	if expected == 0 && ok || expected > 0 && (!ok || old.Version != expected) {
		return StoredState{}, ErrConflict
	}
	v.Version = expected + 1
	r.states[k] = v
	return v, nil
}
func (r *memoryRepo) ListPendingStates(_ context.Context, limit int) ([]StoredState, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []StoredState{}
	for _, v := range r.states {
		if v.PendingEvent.Valid {
			out = append(out, v)
		}
	}
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}
func (r *memoryRepo) SaveEvent(_ context.Context, event alerting.Event) (StoredEvent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if old, ok := r.events[event.ID]; ok {
		return old, nil
	}
	v := StoredEvent{Event: event}
	r.events[event.ID] = v
	return v, nil
}
func (r *memoryRepo) ListEvents(_ context.Context, q EventQuery) ([]StoredEvent, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []StoredEvent{}
	for _, v := range r.events {
		e := v.Event
		if q.RuleID.Valid && e.RuleID != q.RuleID.Value {
			continue
		}
		if q.AircraftID.Valid && e.Subject.AircraftID != q.AircraftID {
			continue
		}
		if q.FlightID.Valid && e.Subject.FlightID != q.FlightID {
			continue
		}
		if q.Acknowledged.Valid && v.Acknowledged != q.Acknowledged.Value {
			continue
		}
		if e.ID > q.After {
			out = append(out, v)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Event.ID < out[j].Event.ID })
	if len(out) > q.Limit {
		return out[:q.Limit], true, nil
	}
	return out, false, nil
}
func (r *memoryRepo) Acknowledge(_ context.Context, id string, at time.Time) (StoredEvent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	v, ok := r.events[id]
	if !ok {
		return StoredEvent{}, ErrNotFound
	}
	if !v.Acknowledged {
		v.Acknowledged = true
		v.AcknowledgedAt = shared.Some(at)
		r.events[id] = v
	}
	return v, nil
}

type watchScope bool

func (w watchScope) IsWatched(context.Context, alerting.Subject) (bool, error) { return bool(w), nil }

type evidenceOK struct{}

func (evidenceOK) Verify(_ context.Context, _ alerting.AlertRule, o alerting.Observation) (alerting.Truth, error) {
	if o.EventID == "" || o.At.Time.IsZero() || o.Evidence == "" {
		return alerting.TruthUnknown, errors.New("missing event-time evidence")
	}
	if o.At.Uncertainty > time.Minute {
		return alerting.TruthUnknown, nil
	}
	return o.Truth, nil
}
func fixtureObservation(id string, second int, truth alerting.Truth) alerting.Observation {
	return alerting.Observation{EventID: id, Subject: alerting.Subject{AircraftID: shared.Some(shared.AircraftID("aircraft-1")), FlightID: shared.Some(shared.FlightID("flight-1"))}, At: shared.ObservationTime{Time: time.Date(2026, 1, 1, 0, 0, second, 0, time.UTC)}, Truth: truth, Evidence: "fixture:event:" + id}
}
func configuredService(t *testing.T, watched bool) (*Service, *memoryRepo, shared.AlertID) {
	t.Helper()
	repo := newMemoryRepo()
	svc := NewService(repo, watchScope(watched), evidenceOK{})
	rule, err := svc.CreateRule(context.Background(), alerting.AlertRule{ID: "rule-1", Name: "Flight entered", Condition: alerting.ConditionFlightStarted, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	return svc, repo, rule.Rule.ID
}

func TestEvaluateDeduplicatesAndSupportsDeterministicReentryAcrossUncertainty(t *testing.T) {
	ctx := context.Background()
	svc, repo, rule := configuredService(t, true)
	first, err := svc.Evaluate(ctx, rule, fixtureObservation("one", 1, alerting.TruthTrue))
	if err != nil || !first.Event.Valid {
		t.Fatalf("first=%+v err=%v", first, err)
	}
	duplicate, err := svc.Evaluate(ctx, rule, fixtureObservation("one", 1, alerting.TruthTrue))
	if err != nil || duplicate.Event.Valid || duplicate.Reason != "duplicate_observation" {
		t.Fatalf("duplicate=%+v err=%v", duplicate, err)
	}
	held, err := svc.Evaluate(ctx, rule, fixtureObservation("still-true", 2, alerting.TruthTrue))
	if err != nil || held.Event.Valid {
		t.Fatalf("held=%+v err=%v", held, err)
	}
	if _, err = svc.Evaluate(ctx, rule, fixtureObservation("exit", 3, alerting.TruthFalse)); err != nil {
		t.Fatal(err)
	}
	reentered, err := svc.Evaluate(ctx, rule, fixtureObservation("reenter", 4, alerting.TruthTrue))
	if err != nil || !reentered.Event.Valid {
		t.Fatalf("reentered=%+v err=%v", reentered, err)
	}
	uncertainInput := fixtureObservation("gap", 5, alerting.TruthTrue)
	uncertainInput.At.Uncertainty = 5 * time.Minute
	uncertain, err := svc.Evaluate(ctx, rule, uncertainInput)
	if err != nil || uncertain.Event.Valid {
		t.Fatalf("uncertain=%+v err=%v", uncertain, err)
	}
	afterGap, err := svc.Evaluate(ctx, rule, fixtureObservation("after-gap", 6, alerting.TruthTrue))
	if err != nil || !afterGap.Event.Valid {
		t.Fatalf("after gap=%+v err=%v", afterGap, err)
	}
	page, err := svc.ListEvents(ctx, EventQuery{RuleID: shared.Some(rule), Limit: 10})
	if err != nil || len(page.Items) != 3 || len(repo.events) != 3 {
		t.Fatalf("page=%+v events=%d err=%v", page, len(repo.events), err)
	}
}

func TestScopeBackfillAndAcknowledgement(t *testing.T) {
	ctx := context.Background()
	svc, _, rule := configuredService(t, false)
	if _, err := svc.Evaluate(ctx, rule, fixtureObservation("not-watched", 1, alerting.TruthTrue)); !errors.Is(err, ErrNotWatched) {
		t.Fatalf("scope err=%v", err)
	}
	svc, _, rule = configuredService(t, true)
	backfill := fixtureObservation("history", 2, alerting.TruthTrue)
	backfill.IsBackfill = true
	result, err := svc.Evaluate(ctx, rule, backfill)
	if err != nil || result.Event.Valid || result.Reason != "historical_backfill_suppressed" {
		t.Fatalf("backfill=%+v err=%v", result, err)
	}
	live, err := svc.Evaluate(ctx, rule, fixtureObservation("live", 3, alerting.TruthTrue))
	if err != nil || !live.Event.Valid {
		t.Fatalf("live=%+v err=%v", live, err)
	}
	acked, err := svc.Acknowledge(ctx, live.Event.Value.Event.ID)
	if err != nil || !acked.Acknowledged || !acked.AcknowledgedAt.Valid {
		t.Fatalf("ack=%+v err=%v", acked, err)
	}
	again, err := svc.Acknowledge(ctx, live.Event.Value.Event.ID)
	if err != nil || !again.Acknowledged || !again.AcknowledgedAt.Value.Equal(acked.AcknowledgedAt.Value) {
		t.Fatalf("ack retry=%+v err=%v", again, err)
	}
}

func TestPendingOutboxRecoveryPersistsAndClearsNotification(t *testing.T) {
	ctx := context.Background()
	svc, repo, rule := configuredService(t, true)
	obs := fixtureObservation("restart-event", 9, alerting.TruthTrue)
	transition, err := alerting.ApplyObservation(alerting.AlertRule{ID: rule, Name: "Flight entered", Condition: alerting.ConditionFlightStarted, Enabled: true}, alerting.State{}, obs)
	if err != nil || !transition.Event.Valid {
		t.Fatalf("transition=%+v err=%v", transition, err)
	}
	state := StoredState{State: transition.State, PendingEvent: transition.Event}
	if _, err := repo.SaveState(ctx, 0, state); err != nil {
		t.Fatal(err)
	}
	recovered, err := svc.RecoverPending(ctx, 10)
	if err != nil || recovered != 1 {
		t.Fatalf("recovered=%d err=%v", recovered, err)
	}
	page, err := svc.ListEvents(ctx, EventQuery{AircraftID: obs.Subject.AircraftID, Limit: 10})
	if err != nil || len(page.Items) != 1 {
		t.Fatalf("events=%+v err=%v", page, err)
	}
	pending, err := repo.ListPendingStates(ctx, 10)
	if err != nil || len(pending) != 0 {
		t.Fatalf("pending=%+v err=%v", pending, err)
	}
}
