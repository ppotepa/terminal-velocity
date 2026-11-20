// Package alerting defines pure alert rules and idempotent condition transitions.
// Runtime evaluation and persistence are implemented by later application layers.
package alerting

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

type ConditionKind string

const (
	ConditionAircraftDetected ConditionKind = "aircraft_detected"
	ConditionFlightStarted    ConditionKind = "flight_started"
	ConditionFlightEnded      ConditionKind = "flight_ended"
	ConditionCountryEntered   ConditionKind = "country_entered"
	ConditionGeofenceEntered  ConditionKind = "geofence_entered"
	ConditionThreshold        ConditionKind = "threshold"
	ConditionMessageObserved  ConditionKind = "message_observed"
	ConditionMessageDecoded   ConditionKind = "message_decoded"
	ConditionFeedError        ConditionKind = "feed_error"
)

type AlertRule struct {
	ID              shared.AlertID `json:"id"`
	Name            string         `json:"name"`
	Condition       ConditionKind  `json:"condition"`
	Enabled         bool           `json:"enabled"`
	Cooldown        time.Duration  `json:"cooldown"`
	IncludeBackfill bool           `json:"include_backfill"`
}

func NewAlertRule(rule AlertRule) (AlertRule, error) {
	if _, err := shared.NewAlertID(string(rule.ID)); err != nil {
		return AlertRule{}, fmt.Errorf("alert rule id: %w", err)
	}
	rule.Name = strings.TrimSpace(rule.Name)
	if rule.Name == "" || len(rule.Name) > 120 {
		return AlertRule{}, shared.NewDomainError(shared.ErrInvalidInput, "alert rule name must contain 1-120 characters")
	}
	if !validCondition(rule.Condition) {
		return AlertRule{}, shared.NewDomainError(shared.ErrInvalidInput, "unsupported alert condition")
	}
	if rule.Cooldown < 0 || rule.Cooldown > 365*24*time.Hour {
		return AlertRule{}, shared.NewDomainError(shared.ErrOutOfRange, "alert cooldown must be between 0 and 365 days")
	}
	return rule, nil
}

func validCondition(kind ConditionKind) bool {
	switch kind {
	case ConditionAircraftDetected, ConditionFlightStarted, ConditionFlightEnded, ConditionCountryEntered, ConditionGeofenceEntered, ConditionThreshold, ConditionMessageObserved, ConditionMessageDecoded, ConditionFeedError:
		return true
	default:
		return false
	}
}

type Truth string

const (
	TruthTrue    Truth = "true"
	TruthFalse   Truth = "false"
	TruthUnknown Truth = "unknown"
)

type Subject struct {
	AircraftID shared.Optional[shared.AircraftID] `json:"aircraft_id,omitempty"`
	FlightID   shared.Optional[shared.FlightID]   `json:"flight_id,omitempty"`
}

func (s Subject) Validate() error {
	if !s.AircraftID.Valid && !s.FlightID.Valid {
		return shared.NewDomainError(shared.ErrInvalidInput, "alert subject requires an aircraft or flight")
	}
	if s.AircraftID.Valid {
		if _, err := shared.NewAircraftID(string(s.AircraftID.Value)); err != nil {
			return err
		}
	}
	if s.FlightID.Valid {
		if _, err := shared.NewFlightID(string(s.FlightID.Value)); err != nil {
			return err
		}
	}
	return nil
}

type Observation struct {
	EventID    string                 `json:"event_id"`
	Subject    Subject                `json:"subject"`
	At         shared.ObservationTime `json:"at"`
	Truth      Truth                  `json:"truth"`
	IsBackfill bool                   `json:"is_backfill"`
	Evidence   string                 `json:"evidence"`
}

type State struct {
	RuleID          shared.AlertID             `json:"rule_id"`
	Subject         Subject                    `json:"subject"`
	LastTruth       Truth                      `json:"last_truth"`
	LastTriggeredAt shared.Optional[time.Time] `json:"last_triggered_at,omitempty"`
	SeenEventIDs    []string                   `json:"seen_event_ids,omitempty"`
}

type Event struct {
	ID         string                 `json:"id"`
	RuleID     shared.AlertID         `json:"rule_id"`
	Condition  ConditionKind          `json:"condition"`
	Subject    Subject                `json:"subject"`
	ObservedAt shared.ObservationTime `json:"observed_at"`
	Backfill   bool                   `json:"backfill"`
	Evidence   string                 `json:"evidence"`
}

type Transition struct {
	State  State                  `json:"state"`
	Event  shared.Optional[Event] `json:"event,omitempty"`
	Reason string                 `json:"reason"`
}

// ApplyObservation evaluates a single condition observation. UNKNOWN never
// fires and clears the remembered truth so later confirmed TRUE evidence is a
// fresh transition. Duplicate observation IDs are ignored across the retained
// state window. Backfill is silent unless the rule opts in.
func ApplyObservation(rule AlertRule, state State, observation Observation) (Transition, error) {
	validated, err := NewAlertRule(rule)
	if err != nil {
		return Transition{}, err
	}
	if err := observation.Subject.Validate(); err != nil {
		return Transition{}, err
	}
	if observation.EventID == "" || len(observation.EventID) > 256 {
		return Transition{}, shared.NewDomainError(shared.ErrInvalidInput, "observation event ID must contain 1-256 characters")
	}
	if observation.At.Time.IsZero() || observation.At.Precision < 0 || observation.At.Uncertainty < 0 {
		return Transition{}, shared.NewDomainError(shared.ErrInvalidInput, "observation time evidence is invalid")
	}
	if observation.Truth != TruthTrue && observation.Truth != TruthFalse && observation.Truth != TruthUnknown {
		return Transition{}, shared.NewDomainError(shared.ErrInvalidInput, "condition truth must be true, false, or unknown")
	}
	if state.RuleID != "" && state.RuleID != validated.ID {
		return Transition{}, shared.NewDomainError(shared.ErrConflict, "alert state belongs to a different rule")
	}
	if state.Subject.AircraftID.Valid || state.Subject.FlightID.Valid {
		if state.Subject != observation.Subject {
			return Transition{}, shared.NewDomainError(shared.ErrConflict, "alert state belongs to a different subject")
		}
	}
	for _, seen := range state.SeenEventIDs {
		if seen == observation.EventID {
			return Transition{State: state, Reason: "duplicate_observation"}, nil
		}
	}
	state.RuleID, state.Subject = validated.ID, observation.Subject
	state.SeenEventIDs = appendBounded(state.SeenEventIDs, observation.EventID, 1024)
	if !validated.Enabled {
		return Transition{State: state, Reason: "rule_disabled"}, nil
	}
	if observation.IsBackfill && !validated.IncludeBackfill {
		return Transition{State: state, Reason: "historical_backfill_suppressed"}, nil
	}
	if observation.Truth == TruthUnknown {
		state.LastTruth = TruthUnknown
		return Transition{State: state, Reason: "condition_unknown_does_not_fire"}, nil
	}
	wasTrue := state.LastTruth == TruthTrue
	state.LastTruth = observation.Truth
	if observation.Truth != TruthTrue {
		return Transition{State: state, Reason: "condition_false"}, nil
	}
	if wasTrue {
		return Transition{State: state, Reason: "condition_remains_true"}, nil
	}
	if state.LastTriggeredAt.Valid && observation.At.Time.Sub(state.LastTriggeredAt.Value) < validated.Cooldown {
		return Transition{State: state, Reason: "cooldown_active"}, nil
	}
	if strings.TrimSpace(observation.Evidence) == "" {
		return Transition{}, shared.NewDomainError(shared.ErrInvalidInput, "true alert observation requires evidence")
	}
	eventID := triggerIdentity(validated.ID, observation)
	event := Event{ID: eventID, RuleID: validated.ID, Condition: validated.Condition, Subject: observation.Subject, ObservedAt: observation.At, Backfill: observation.IsBackfill, Evidence: observation.Evidence}
	state.LastTriggeredAt = shared.Some(observation.At.Time.UTC())
	return Transition{State: state, Event: shared.Some(event), Reason: "condition_entered_true"}, nil
}

func triggerIdentity(ruleID shared.AlertID, observation Observation) string {
	h := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%s|%s|%s", ruleID, observation.Subject.AircraftID.Value, observation.Subject.FlightID.Value, observation.EventID, observation.At.Time.UTC().Format(time.RFC3339Nano))))
	return hex.EncodeToString(h[:])
}

func appendBounded(values []string, value string, max int) []string {
	if len(values) >= max {
		values = append([]string(nil), values[len(values)-max+1:]...)
	}
	return append(values, value)
}
