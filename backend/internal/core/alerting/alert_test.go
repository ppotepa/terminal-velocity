package alerting

import (
	"testing"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

func alertAt(seconds int) shared.ObservationTime {
	at, _ := shared.NewObservationTime(time.Date(2025, 1, 1, 0, 0, seconds, 0, time.UTC), time.Second, 0)
	return at
}

func alertRule() AlertRule {
	return AlertRule{ID: "rule-1", Name: "Flight started", Condition: ConditionFlightStarted, Enabled: true, Cooldown: 30 * time.Second}
}
func subject() Subject {
	return Subject{AircraftID: shared.Some(shared.AircraftID("aircraft-1")), FlightID: shared.Some(shared.FlightID("flight-1"))}
}
func observation(id string, sec int, truth Truth) Observation {
	return Observation{EventID: id, Subject: subject(), At: alertAt(sec), Truth: truth, Evidence: "observed flight boundary"}
}

func TestConditionTransitionsFireOnceAndAllowReentry(t *testing.T) {
	rule := alertRule()
	state := State{}
	first, err := ApplyObservation(rule, state, observation("event-1", 0, TruthTrue))
	if err != nil || !first.Event.Valid {
		t.Fatalf("initial true should trigger: %+v %v", first, err)
	}
	second, err := ApplyObservation(rule, first.State, observation("event-2", 1, TruthTrue))
	if err != nil || second.Event.Valid || second.Reason != "condition_remains_true" {
		t.Fatalf("repeat true should not notify: %+v %v", second, err)
	}
	falseState, err := ApplyObservation(rule, second.State, observation("event-3", 2, TruthFalse))
	if err != nil || falseState.Event.Valid {
		t.Fatalf("false should not notify: %+v %v", falseState, err)
	}
	blocked, err := ApplyObservation(rule, falseState.State, observation("event-4", 10, TruthTrue))
	if err != nil || blocked.Event.Valid || blocked.Reason != "cooldown_active" {
		t.Fatalf("cooldown should suppress repeat: %+v %v", blocked, err)
	}
	reset, err := ApplyObservation(rule, blocked.State, observation("event-5", 40, TruthFalse))
	if err != nil {
		t.Fatal(err)
	}
	reentered, err := ApplyObservation(rule, reset.State, observation("event-6", 41, TruthTrue))
	if err != nil || !reentered.Event.Valid {
		t.Fatalf("re-entry after cooldown should trigger: %+v %v", reentered, err)
	}
}

func TestUnknownAndBackfillNeverFireByDefault(t *testing.T) {
	rule := alertRule()
	unknown, err := ApplyObservation(rule, State{}, observation("unknown", 0, TruthUnknown))
	if err != nil || unknown.Event.Valid || unknown.State.LastTruth != TruthUnknown {
		t.Fatalf("unknown condition handling: %+v %v", unknown, err)
	}
	backfill := observation("history", 1, TruthTrue)
	backfill.IsBackfill = true
	suppressed, err := ApplyObservation(rule, unknown.State, backfill)
	if err != nil || suppressed.Event.Valid || suppressed.Reason != "historical_backfill_suppressed" {
		t.Fatalf("backfill should be suppressed: %+v %v", suppressed, err)
	}
	rule.IncludeBackfill = true
	allowed, err := ApplyObservation(rule, State{}, backfill)
	if err != nil || !allowed.Event.Valid || !allowed.Event.Value.Backfill {
		t.Fatalf("explicit backfill opt-in did not fire: %+v %v", allowed, err)
	}
}

func TestDuplicateObservationAndEventIdentityAreDeterministic(t *testing.T) {
	rule := alertRule()
	input := observation("same-event", 100, TruthTrue)
	first, err := ApplyObservation(rule, State{}, input)
	if err != nil || !first.Event.Valid {
		t.Fatalf("first observation failed: %+v %v", first, err)
	}
	duplicate, err := ApplyObservation(rule, first.State, input)
	if err != nil || duplicate.Event.Valid || duplicate.Reason != "duplicate_observation" {
		t.Fatalf("duplicate fired: %+v %v", duplicate, err)
	}
	otherState, err := ApplyObservation(rule, State{}, input)
	if err != nil || first.Event.Value.ID != otherState.Event.Value.ID {
		t.Fatal("event identity is not deterministic")
	}
	otherSubject := input
	otherSubject.Subject = Subject{AircraftID: shared.Some(shared.AircraftID("aircraft-2"))}
	otherSubject.EventID = "other-subject"
	other, err := ApplyObservation(rule, State{}, otherSubject)
	if err != nil || first.Event.Value.ID == other.Event.Value.ID {
		t.Fatal("event identity is not scoped to subject")
	}
}

func TestDisabledRulesAndMismatchedState(t *testing.T) {
	rule := alertRule()
	rule.Enabled = false
	result, err := ApplyObservation(rule, State{}, observation("event", 1, TruthTrue))
	if err != nil || result.Event.Valid || result.Reason != "rule_disabled" {
		t.Fatalf("disabled rule fired: %+v %v", result, err)
	}
	rule.Enabled = true
	wrongState := State{RuleID: "rule-2", Subject: subject()}
	if _, err := ApplyObservation(rule, wrongState, observation("event-2", 2, TruthTrue)); err == nil {
		t.Fatal("accepted state from another rule")
	}
}

func TestValidationRejectsUnknownConditionAndMissingEvidence(t *testing.T) {
	rule := alertRule()
	rule.Condition = "magic"
	if _, err := NewAlertRule(rule); err == nil {
		t.Fatal("accepted unknown alert condition")
	}
	rule = alertRule()
	input := observation("event", 0, TruthTrue)
	input.Evidence = ""
	if _, err := ApplyObservation(rule, State{}, input); err == nil {
		t.Fatal("fired alert without evidence")
	}
	if _, err := ApplyObservation(rule, State{}, Observation{EventID: "event", At: alertAt(0), Truth: TruthTrue}); err == nil {
		t.Fatal("accepted alert without subject")
	}
}
