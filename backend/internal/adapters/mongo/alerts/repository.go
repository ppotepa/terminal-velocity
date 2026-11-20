// Package alerts stores versioned alert rules, transition state, outbox entries and acknowledged events.
package alerts

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	application "github.com/ppotepa/terminal-velocity/backend/internal/application/alerting"
	core "github.com/ppotepa/terminal-velocity/backend/internal/core/alerting"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"go.mongodb.org/mongo-driver/v2/bson"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const (
	ruleCollection  = "alert_rules"
	stateCollection = "alert_states"
	eventCollection = "alert_events"
)

type ruleDoc struct {
	ID        string         `bson:"_id"`
	Rule      core.AlertRule `bson:"rule"`
	Revision  int64          `bson:"revision"`
	UpdatedAt time.Time      `bson:"updated_at"`
}
type stateDoc struct {
	ID              string     `bson:"_id"`
	RuleID          string     `bson:"rule_id"`
	AircraftID      string     `bson:"aircraft_id"`
	FlightID        string     `bson:"flight_id"`
	State           core.State `bson:"state"`
	Version         int64      `bson:"version"`
	HasPendingEvent bool       `bson:"has_pending_event"`
	PendingEvent    core.Event `bson:"pending_event,omitempty"`
}
type eventDoc struct {
	ID             string     `bson:"_id"`
	RuleID         string     `bson:"rule_id"`
	AircraftID     string     `bson:"aircraft_id,omitempty"`
	FlightID       string     `bson:"flight_id,omitempty"`
	Acknowledged   bool       `bson:"acknowledged"`
	AcknowledgedAt time.Time  `bson:"acknowledged_at,omitempty"`
	Event          core.Event `bson:"event"`
}
type Repository struct{ rules, states, events *driver.Collection }

func NewRepository(db *driver.Database) *Repository {
	return &Repository{rules: db.Collection(ruleCollection), states: db.Collection(stateCollection), events: db.Collection(eventCollection)}
}
func (r *Repository) EnsureIndexes(ctx context.Context) error {
	if _, err := r.rules.Indexes().CreateOne(ctx, driver.IndexModel{Keys: bson.D{{Key: "revision", Value: 1}}, Options: options.Index().SetName("alert_rule_revision")}); err != nil {
		return err
	}
	if _, err := r.states.Indexes().CreateMany(ctx, []driver.IndexModel{{Keys: bson.D{{Key: "rule_id", Value: 1}, {Key: "aircraft_id", Value: 1}, {Key: "flight_id", Value: 1}}, Options: options.Index().SetUnique(true).SetName("alert_state_subject")}, {Keys: bson.D{{Key: "has_pending_event", Value: 1}, {Key: "_id", Value: 1}}, Options: options.Index().SetName("alert_pending_outbox")}}); err != nil {
		return err
	}
	_, err := r.events.Indexes().CreateMany(ctx, []driver.IndexModel{{Keys: bson.D{{Key: "rule_id", Value: 1}, {Key: "_id", Value: 1}}, Options: options.Index().SetName("alert_rule_events")}, {Keys: bson.D{{Key: "aircraft_id", Value: 1}, {Key: "_id", Value: 1}}, Options: options.Index().SetName("alert_aircraft_events")}, {Keys: bson.D{{Key: "flight_id", Value: 1}, {Key: "_id", Value: 1}}, Options: options.Index().SetName("alert_flight_events")}, {Keys: bson.D{{Key: "acknowledged", Value: 1}, {Key: "_id", Value: 1}}, Options: options.Index().SetName("alert_ack_events")}})
	return err
}
func (r *Repository) GetRule(ctx context.Context, id shared.AlertID) (application.StoredRule, error) {
	var d ruleDoc
	err := r.rules.FindOne(ctx, bson.D{{Key: "_id", Value: string(id)}}).Decode(&d)
	if errors.Is(err, driver.ErrNoDocuments) {
		return application.StoredRule{}, application.ErrNotFound
	}
	if err != nil {
		return application.StoredRule{}, err
	}
	return application.StoredRule{Rule: d.Rule, Revision: d.Revision, UpdatedAt: d.UpdatedAt.UTC()}, nil
}
func (r *Repository) SaveRule(ctx context.Context, rule core.AlertRule, expected int64, now time.Time) (application.StoredRule, error) {
	if expected == 0 {
		d := ruleDoc{ID: string(rule.ID), Rule: rule, Revision: 1, UpdatedAt: now.UTC()}
		_, err := r.rules.InsertOne(ctx, d)
		if driver.IsDuplicateKeyError(err) {
			return application.StoredRule{}, application.ErrConflict
		}
		if err != nil {
			return application.StoredRule{}, err
		}
		return application.StoredRule{Rule: rule, Revision: 1, UpdatedAt: d.UpdatedAt}, nil
	}
	filter := bson.D{{Key: "_id", Value: string(rule.ID)}, {Key: "revision", Value: expected}}
	update := bson.D{{Key: "$set", Value: bson.D{{Key: "rule", Value: rule}, {Key: "revision", Value: expected + 1}, {Key: "updated_at", Value: now.UTC()}}}}
	var d ruleDoc
	err := r.rules.FindOneAndUpdate(ctx, filter, update, options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&d)
	if errors.Is(err, driver.ErrNoDocuments) {
		if _, e := r.GetRule(ctx, rule.ID); errors.Is(e, application.ErrNotFound) {
			return application.StoredRule{}, application.ErrNotFound
		} else if e != nil {
			return application.StoredRule{}, e
		}
		return application.StoredRule{}, application.ErrConflict
	}
	if err != nil {
		return application.StoredRule{}, err
	}
	return application.StoredRule{Rule: d.Rule, Revision: d.Revision, UpdatedAt: d.UpdatedAt.UTC()}, nil
}
func (r *Repository) ListRules(ctx context.Context, after string, limit int) ([]application.StoredRule, bool, error) {
	filter := bson.D{{Key: "_id", Value: bson.D{{Key: "$gt", Value: after}}}}
	cur, err := r.rules.Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}).SetLimit(int64(limit+1)))
	if err != nil {
		return nil, false, err
	}
	defer cur.Close(ctx)
	docs := []ruleDoc{}
	for cur.Next(ctx) {
		var d ruleDoc
		if err := cur.Decode(&d); err != nil {
			return nil, false, err
		}
		docs = append(docs, d)
	}
	if err := cur.Err(); err != nil {
		return nil, false, err
	}
	more := len(docs) > limit
	if more {
		docs = docs[:limit]
	}
	out := make([]application.StoredRule, 0, len(docs))
	for _, d := range docs {
		out = append(out, application.StoredRule{Rule: d.Rule, Revision: d.Revision, UpdatedAt: d.UpdatedAt.UTC()})
	}
	return out, more, nil
}
func stateID(ruleID shared.AlertID, subject core.Subject) string {
	aircraftID, flightID := "", ""
	if subject.AircraftID.Valid {
		aircraftID = string(subject.AircraftID.Value)
	}
	if subject.FlightID.Valid {
		flightID = string(subject.FlightID.Value)
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s\x00%s\x00%s", ruleID, aircraftID, flightID)))
	return "state_" + hex.EncodeToString(sum[:])
}
func stateDocFrom(v application.StoredState) stateDoc {
	ruleID := v.State.RuleID
	var pending core.Event
	hasPending := v.PendingEvent.Valid
	if hasPending {
		pending = v.PendingEvent.Value
	}
	return stateDoc{ID: stateID(ruleID, v.State.Subject), RuleID: string(ruleID), AircraftID: string(v.State.Subject.AircraftID.Value), FlightID: string(v.State.Subject.FlightID.Value), State: v.State, Version: v.Version, HasPendingEvent: hasPending, PendingEvent: pending}
}
func storedState(d stateDoc) application.StoredState {
	v := application.StoredState{State: d.State, Version: d.Version}
	if d.HasPendingEvent {
		v.PendingEvent = shared.Some(d.PendingEvent)
	}
	return v
}
func (r *Repository) GetState(ctx context.Context, ruleID shared.AlertID, subject core.Subject) (application.StoredState, error) {
	var d stateDoc
	err := r.states.FindOne(ctx, bson.D{{Key: "_id", Value: stateID(ruleID, subject)}}).Decode(&d)
	if errors.Is(err, driver.ErrNoDocuments) {
		return application.StoredState{}, application.ErrStateNotFound
	}
	if err != nil {
		return application.StoredState{}, err
	}
	return storedState(d), nil
}
func (r *Repository) SaveState(ctx context.Context, expected int64, v application.StoredState) (application.StoredState, error) {
	d := stateDocFrom(v)
	d.Version = expected + 1
	if expected == 0 {
		_, err := r.states.InsertOne(ctx, d)
		if driver.IsDuplicateKeyError(err) {
			return application.StoredState{}, application.ErrConflict
		}
		if err != nil {
			return application.StoredState{}, err
		}
		return storedState(d), nil
	}
	filter := bson.D{{Key: "_id", Value: d.ID}, {Key: "version", Value: expected}}
	update := bson.D{{Key: "$set", Value: bson.D{{Key: "state", Value: d.State}, {Key: "version", Value: d.Version}, {Key: "has_pending_event", Value: d.HasPendingEvent}, {Key: "pending_event", Value: d.PendingEvent}}}}
	var updated stateDoc
	err := r.states.FindOneAndUpdate(ctx, filter, update, options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&updated)
	if errors.Is(err, driver.ErrNoDocuments) {
		return application.StoredState{}, application.ErrConflict
	}
	if err != nil {
		return application.StoredState{}, err
	}
	return storedState(updated), nil
}
func (r *Repository) ListPendingStates(ctx context.Context, limit int) ([]application.StoredState, error) {
	cur, err := r.states.Find(ctx, bson.D{{Key: "has_pending_event", Value: true}}, options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	out := []application.StoredState{}
	for cur.Next(ctx) {
		var d stateDoc
		if err := cur.Decode(&d); err != nil {
			return nil, err
		}
		out = append(out, storedState(d))
	}
	return out, cur.Err()
}
func (r *Repository) SaveEvent(ctx context.Context, event core.Event) (application.StoredEvent, error) {
	d := eventDoc{ID: event.ID, RuleID: string(event.RuleID), Event: event}
	if event.Subject.AircraftID.Valid {
		d.AircraftID = string(event.Subject.AircraftID.Value)
	}
	if event.Subject.FlightID.Valid {
		d.FlightID = string(event.Subject.FlightID.Value)
	}
	_, err := r.events.InsertOne(ctx, d)
	if err == nil {
		return application.StoredEvent{Event: event}, nil
	}
	if !driver.IsDuplicateKeyError(err) {
		return application.StoredEvent{}, err
	}
	var existing eventDoc
	if e := r.events.FindOne(ctx, bson.D{{Key: "_id", Value: event.ID}}).Decode(&existing); e != nil {
		return application.StoredEvent{}, e
	}
	return storedEvent(existing), nil
}
func storedEvent(d eventDoc) application.StoredEvent {
	v := application.StoredEvent{Event: d.Event, Acknowledged: d.Acknowledged}
	if !d.AcknowledgedAt.IsZero() {
		v.AcknowledgedAt = shared.Some(d.AcknowledgedAt.UTC())
	}
	return v
}
func (r *Repository) ListEvents(ctx context.Context, q application.EventQuery) ([]application.StoredEvent, bool, error) {
	filter := bson.D{}
	if q.RuleID.Valid {
		filter = append(filter, bson.E{Key: "rule_id", Value: string(q.RuleID.Value)})
	}
	if q.AircraftID.Valid {
		filter = append(filter, bson.E{Key: "aircraft_id", Value: string(q.AircraftID.Value)})
	}
	if q.FlightID.Valid {
		filter = append(filter, bson.E{Key: "flight_id", Value: string(q.FlightID.Value)})
	}
	if q.Acknowledged.Valid {
		filter = append(filter, bson.E{Key: "acknowledged", Value: q.Acknowledged.Value})
	}
	if q.After != "" {
		filter = append(filter, bson.E{Key: "_id", Value: bson.D{{Key: "$gt", Value: q.After}}})
	}
	cur, err := r.events.Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}).SetLimit(int64(q.Limit+1)))
	if err != nil {
		return nil, false, err
	}
	defer cur.Close(ctx)
	docs := []eventDoc{}
	for cur.Next(ctx) {
		var d eventDoc
		if err := cur.Decode(&d); err != nil {
			return nil, false, err
		}
		docs = append(docs, d)
	}
	if err := cur.Err(); err != nil {
		return nil, false, err
	}
	more := len(docs) > q.Limit
	if more {
		docs = docs[:q.Limit]
	}
	out := make([]application.StoredEvent, 0, len(docs))
	for _, d := range docs {
		out = append(out, storedEvent(d))
	}
	return out, more, nil
}
func (r *Repository) Acknowledge(ctx context.Context, id string, now time.Time) (application.StoredEvent, error) {
	filter := bson.D{{Key: "_id", Value: id}, {Key: "acknowledged", Value: false}}
	update := bson.D{{Key: "$set", Value: bson.D{{Key: "acknowledged", Value: true}, {Key: "acknowledged_at", Value: now.UTC()}}}}
	_, err := r.events.UpdateOne(ctx, filter, update)
	if err != nil {
		return application.StoredEvent{}, err
	}
	var d eventDoc
	if err := r.events.FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&d); errors.Is(err, driver.ErrNoDocuments) {
		return application.StoredEvent{}, application.ErrNotFound
	} else if err != nil {
		return application.StoredEvent{}, err
	}
	return storedEvent(d), nil
}

var _ application.Repository = (*Repository)(nil)
