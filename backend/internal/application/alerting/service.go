// Package alerting evaluates verified observations, persists transitions and exposes notification history.
package alerting

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/alerting"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

var (
	ErrNotFound      = errors.New("alert rule or event not found")
	ErrConflict      = errors.New("alert rule or state revision conflict")
	ErrStateNotFound = errors.New("alert state not found")
	ErrNotWatched    = errors.New("alert subject is not currently watched")
	ErrInvalidQuery  = errors.New("invalid alert history query")
)

const (
	MaxPageSize        = 200
	DefaultPageSize    = 50
	MaxStateRetries    = 8
	MaxPendingRecovery = 500
)

type StoredRule struct {
	Rule      alerting.AlertRule `json:"rule" bson:"rule"`
	Revision  int64              `json:"revision" bson:"revision"`
	UpdatedAt time.Time          `json:"updated_at" bson:"updated_at"`
}
type StoredState struct {
	State        alerting.State                  `json:"state" bson:"state"`
	Version      int64                           `json:"version" bson:"version"`
	PendingEvent shared.Optional[alerting.Event] `json:"pending_event,omitempty" bson:"pending_event,omitempty"`
}
type StoredEvent struct {
	Event          alerting.Event             `json:"event" bson:"event"`
	Acknowledged   bool                       `json:"acknowledged" bson:"acknowledged"`
	AcknowledgedAt shared.Optional[time.Time] `json:"acknowledged_at,omitempty" bson:"acknowledged_at,omitempty"`
}
type RulePage struct {
	Items []StoredRule            `json:"items"`
	Next  shared.Optional[string] `json:"next,omitempty"`
}
type EventQuery struct {
	RuleID       shared.Optional[shared.AlertID]
	AircraftID   shared.Optional[shared.AircraftID]
	FlightID     shared.Optional[shared.FlightID]
	Acknowledged shared.Optional[bool]
	After        string
	Limit        int
}
type EventPage struct {
	Items []StoredEvent           `json:"items"`
	Next  shared.Optional[string] `json:"next,omitempty"`
}
type Repository interface {
	GetRule(context.Context, shared.AlertID) (StoredRule, error)
	SaveRule(context.Context, alerting.AlertRule, int64, time.Time) (StoredRule, error)
	ListRules(context.Context, string, int) ([]StoredRule, bool, error)
	GetState(context.Context, shared.AlertID, alerting.Subject) (StoredState, error)
	SaveState(context.Context, int64, StoredState) (StoredState, error)
	ListPendingStates(context.Context, int) ([]StoredState, error)
	SaveEvent(context.Context, alerting.Event) (StoredEvent, error)
	ListEvents(context.Context, EventQuery) ([]StoredEvent, bool, error)
	Acknowledge(context.Context, string, time.Time) (StoredEvent, error)
}
type ScopeVerifier interface {
	IsWatched(context.Context, alerting.Subject) (bool, error)
}
type EvidenceVerifier interface {
	// Verify returns the evidence-backed truth; uncertain event-time evidence,
	// including transitions across an observation gap, must return TruthUnknown.
	Verify(context.Context, alerting.AlertRule, alerting.Observation) (alerting.Truth, error)
}
type Evaluation struct {
	Reason string                       `json:"reason"`
	Event  shared.Optional[StoredEvent] `json:"event,omitempty"`
	State  alerting.State               `json:"state"`
}
type Service struct {
	repo     Repository
	scope    ScopeVerifier
	evidence EvidenceVerifier
	now      func() time.Time
}

func NewService(repo Repository, scope ScopeVerifier, evidence EvidenceVerifier) *Service {
	return &Service{repo: repo, scope: scope, evidence: evidence, now: func() time.Time { return time.Now().UTC() }}
}

func (s *Service) CreateRule(ctx context.Context, rule alerting.AlertRule) (StoredRule, error) {
	validated, err := alerting.NewAlertRule(rule)
	if err != nil {
		return StoredRule{}, err
	}
	return s.repo.SaveRule(ctx, validated, 0, s.now().UTC())
}
func (s *Service) UpdateRule(ctx context.Context, rule alerting.AlertRule, expected int64) (StoredRule, error) {
	if expected < 1 {
		return StoredRule{}, shared.NewDomainError(shared.ErrInvalidInput, "expected alert rule revision must be positive")
	}
	validated, err := alerting.NewAlertRule(rule)
	if err != nil {
		return StoredRule{}, err
	}
	return s.repo.SaveRule(ctx, validated, expected, s.now().UTC())
}
func (s *Service) ListRules(ctx context.Context, after string, limit int) (RulePage, error) {
	if limit == 0 {
		limit = DefaultPageSize
	}
	if limit < 1 || limit > MaxPageSize {
		return RulePage{}, ErrInvalidQuery
	}
	if after != "" {
		if _, err := shared.NewAlertID(after); err != nil {
			return RulePage{}, err
		}
	}
	items, more, err := s.repo.ListRules(ctx, after, limit)
	if err != nil {
		return RulePage{}, err
	}
	page := RulePage{Items: items}
	if more && len(items) > 0 {
		page.Next = shared.Some(string(items[len(items)-1].Rule.ID))
	}
	return page, nil
}

func (s *Service) Evaluate(ctx context.Context, ruleID shared.AlertID, observation alerting.Observation) (Evaluation, error) {
	ruleRecord, err := s.repo.GetRule(ctx, ruleID)
	if err != nil {
		return Evaluation{}, err
	}
	rule := ruleRecord.Rule
	if err := observation.Subject.Validate(); err != nil {
		return Evaluation{}, err
	}
	if s.scope == nil || s.evidence == nil {
		return Evaluation{}, errors.New("alert scope and evidence verifiers are required")
	}
	watched, err := s.scope.IsWatched(ctx, observation.Subject)
	if err != nil {
		return Evaluation{}, err
	}
	if !watched {
		return Evaluation{}, ErrNotWatched
	}
	truth, err := s.evidence.Verify(ctx, rule, observation)
	if err != nil {
		return Evaluation{}, fmt.Errorf("alert evidence rejected: %w", err)
	}
	observation.Truth = truth
	for attempt := 0; attempt < MaxStateRetries; attempt++ {
		stored, err := s.repo.GetState(ctx, rule.ID, observation.Subject)
		if errors.Is(err, ErrStateNotFound) {
			stored = StoredState{State: alerting.State{RuleID: rule.ID, Subject: observation.Subject}}
		} else if err != nil {
			return Evaluation{}, err
		}
		if stored.PendingEvent.Valid {
			stored, err = s.flushPending(ctx, stored)
			if errors.Is(err, ErrConflict) {
				continue
			}
			if err != nil {
				return Evaluation{}, err
			}
		}
		transition, err := alerting.ApplyObservation(rule, stored.State, observation)
		if err != nil {
			return Evaluation{}, err
		}
		if transition.Reason == "duplicate_observation" {
			return Evaluation{Reason: transition.Reason, State: stored.State}, nil
		}
		next := StoredState{State: transition.State, Version: stored.Version}
		if transition.Event.Valid {
			next.PendingEvent = transition.Event
		}
		committed, err := s.repo.SaveState(ctx, stored.Version, next)
		if errors.Is(err, ErrConflict) {
			continue
		}
		if err != nil {
			return Evaluation{}, err
		}
		result := Evaluation{Reason: transition.Reason, State: committed.State}
		if committed.PendingEvent.Valid {
			final, err := s.flushPending(ctx, committed)
			if err != nil {
				return Evaluation{}, err
			}
			result.State = final.State
			if transition.Event.Valid {
				event, err := s.repo.SaveEvent(ctx, transition.Event.Value)
				if err != nil {
					return Evaluation{}, err
				}
				result.Event = shared.Some(event)
			}
		}
		return result, nil
	}
	return Evaluation{}, ErrConflict
}

// flushPending completes an outbox event persisted atomically with its state transition.
func (s *Service) flushPending(ctx context.Context, state StoredState) (StoredState, error) {
	if !state.PendingEvent.Valid {
		return state, nil
	}
	event, err := s.repo.SaveEvent(ctx, state.PendingEvent.Value)
	if err != nil {
		return StoredState{}, err
	}
	_ = event
	next := StoredState{State: state.State, Version: state.Version}
	return s.repo.SaveState(ctx, state.Version, next)
}

// RecoverPending publishes durable outbox entries left by a process restart.
func (s *Service) RecoverPending(ctx context.Context, limit int) (int, error) {
	if limit == 0 {
		limit = MaxPendingRecovery
	}
	if limit < 1 || limit > MaxPendingRecovery {
		return 0, ErrInvalidQuery
	}
	states, err := s.repo.ListPendingStates(ctx, limit)
	if err != nil {
		return 0, err
	}
	completed := 0
	for _, state := range states {
		if _, err := s.flushPending(ctx, state); err != nil {
			if errors.Is(err, ErrConflict) {
				continue
			}
			return completed, err
		}
		completed++
	}
	return completed, nil
}

func (s *Service) ListEvents(ctx context.Context, q EventQuery) (EventPage, error) {
	if !q.RuleID.Valid && !q.AircraftID.Valid && !q.FlightID.Valid {
		return EventPage{}, ErrInvalidQuery
	}
	if q.Limit == 0 {
		q.Limit = DefaultPageSize
	}
	if q.Limit < 1 || q.Limit > MaxPageSize {
		return EventPage{}, ErrInvalidQuery
	}
	if q.After != "" {
		if _, err := hex.DecodeString(q.After); err != nil || len(q.After) != 64 {
			return EventPage{}, ErrInvalidQuery
		}
	}
	if q.RuleID.Valid {
		if _, err := shared.NewAlertID(string(q.RuleID.Value)); err != nil {
			return EventPage{}, err
		}
	}
	if q.AircraftID.Valid {
		if _, err := shared.NewAircraftID(string(q.AircraftID.Value)); err != nil {
			return EventPage{}, err
		}
	}
	if q.FlightID.Valid {
		if _, err := shared.NewFlightID(string(q.FlightID.Value)); err != nil {
			return EventPage{}, err
		}
	}
	items, more, err := s.repo.ListEvents(ctx, q)
	if err != nil {
		return EventPage{}, err
	}
	page := EventPage{Items: items}
	if more && len(items) > 0 {
		page.Next = shared.Some(items[len(items)-1].Event.ID)
	}
	return page, nil
}
func (s *Service) Acknowledge(ctx context.Context, eventID string) (StoredEvent, error) {
	decoded, err := hex.DecodeString(eventID)
	if err != nil || len(decoded) != 32 {
		return StoredEvent{}, shared.NewDomainError(shared.ErrInvalidInput, "alert event identity must be 64 hexadecimal characters")
	}
	return s.repo.Acknowledge(ctx, eventID, s.now().UTC())
}
