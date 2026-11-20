package bootstrap

import (
	"context"
	"encoding/json"
	"errors"

	alertapp "github.com/ppotepa/terminal-velocity/backend/internal/application/alerting"
	watchapp "github.com/ppotepa/terminal-velocity/backend/internal/application/watchlist"
	corealert "github.com/ppotepa/terminal-velocity/backend/internal/core/alerting"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/watch"
	"go.mongodb.org/mongo-driver/v2/bson"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
)

type fixtureAlertScope struct{ rules *watchapp.Service }

func (s fixtureAlertScope) IsWatched(ctx context.Context, subject corealert.Subject) (bool, error) {
	if !subject.AircraftID.Valid {
		return false, nil
	}
	cursor := ""
	for page := 0; page < 10; page++ {
		items, next, err := s.rules.ListEnabled(ctx, cursor, 1000)
		if err != nil {
			return false, err
		}
		for _, item := range items {
			if item.Rule.Status != watch.StatusActive {
				continue
			}
			for _, callsign := range fixtureCallsigns(item.Rule) {
				if fixtureAircraftID(callsign) == subject.AircraftID.Value {
					return true, nil
				}
			}
		}
		if next == "" {
			return false, nil
		}
		cursor = next
	}
	return false, errors.New("active WatchRule set exceeds local alert scope limit")
}

type fixtureAlertEvidence struct{ db *driver.Database }

type fixtureAlertProof struct {
	Source    string `json:"source"`
	Condition string `json:"condition"`
	EventID   string `json:"eventId"`
	Country   string `json:"country,omitempty"`
	Crossing  string `json:"crossing,omitempty"`
}

func (v fixtureAlertEvidence) Verify(ctx context.Context, rule corealert.AlertRule, observation corealert.Observation) (corealert.Truth, error) {
	var proof fixtureAlertProof
	if err := json.Unmarshal([]byte(observation.Evidence), &proof); err != nil || proof.Source != "synthetic-fixture" || proof.Condition != string(rule.Condition) || proof.EventID != observation.EventID {
		return corealert.TruthUnknown, nil
	}
	if rule.Condition == corealert.ConditionCountryEntered {
		if proof.Crossing != "observed" && proof.Crossing != "inferred" {
			return corealert.TruthUnknown, nil
		}
		var config alertRuleParameters
		err := v.db.Collection("alert_rule_configs").FindOne(ctx, bson.D{{Key: "_id", Value: string(rule.ID)}}).Decode(&config)
		if err != nil && !errors.Is(err, driver.ErrNoDocuments) {
			return corealert.TruthUnknown, err
		}
		if expected, ok := config.Parameters["countryCode"].(string); ok && expected != "" && expected != proof.Country {
			return corealert.TruthFalse, nil
		}
		if proof.Country == "" {
			return corealert.TruthUnknown, nil
		}
	}
	return corealert.TruthTrue, nil
}

func fixtureAlertObservation(ruleID shared.AlertID, condition corealert.ConditionKind, aircraft shared.AircraftID, flight shared.FlightID, observed shared.ObservationTime, eventID, country, crossing string) (corealert.Observation, string, error) {
	proof := fixtureAlertProof{Source: "synthetic-fixture", Condition: string(condition), EventID: eventID, Country: country, Crossing: crossing}
	encoded, err := json.Marshal(proof)
	if err != nil {
		return corealert.Observation{}, "", err
	}
	observation := corealert.Observation{EventID: eventID, Subject: corealert.Subject{AircraftID: shared.Some(aircraft), FlightID: shared.Some(flight)}, At: observed, Evidence: string(encoded)}
	if _, err := shared.NewAlertID(string(ruleID)); err != nil {
		return corealert.Observation{}, "", err
	}
	return observation, string(encoded), nil
}

var _ alertapp.ScopeVerifier = fixtureAlertScope{}
var _ alertapp.EvidenceVerifier = fixtureAlertEvidence{}
