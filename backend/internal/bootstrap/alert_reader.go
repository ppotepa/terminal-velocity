package bootstrap

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"time"

	alertstore "github.com/ppotepa/terminal-velocity/backend/internal/adapters/mongo/alerts"
	alertapp "github.com/ppotepa/terminal-velocity/backend/internal/application/alerting"
	corealert "github.com/ppotepa/terminal-velocity/backend/internal/core/alerting"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	httpalerts "github.com/ppotepa/terminal-velocity/backend/internal/transport/http/alerts"
	"go.mongodb.org/mongo-driver/v2/bson"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// alertReader is the HTTP composition adapter. The application service owns
// rule validation, revisions, transitions and acknowledgement; this adapter
// adds the HTTP view and stores the transport-only parameters alongside rules.
type alertReader struct {
	service *alertapp.Service
	repo    *alertstore.Repository
	db      *driver.Database
}

type alertRuleParameters struct {
	ID         string         `bson:"_id"`
	Parameters map[string]any `bson:"parameters"`
}

type alertEventMetadata struct {
	ID        string    `bson:"_id"`
	EmittedAt time.Time `bson:"emitted_at"`
}

func (r alertReader) ListAlertRules(ctx context.Context) ([]httpalerts.Rule, error) {
	out := make([]httpalerts.Rule, 0)
	cursor := ""
	for page := 0; page < 10; page++ {
		result, err := r.service.ListRules(ctx, cursor, alertapp.MaxPageSize)
		if err != nil {
			return nil, err
		}
		for _, stored := range result.Items {
			item, err := r.viewRule(ctx, stored)
			if err != nil {
				return nil, err
			}
			out = append(out, item)
		}
		if !result.Next.Valid {
			return out, nil
		}
		cursor = result.Next.Value
	}
	return nil, errors.New("alert rule listing exceeds the local composition limit")
}

func (r alertReader) GetAlertRule(ctx context.Context, id string) (httpalerts.Rule, error) {
	key, err := shared.NewAlertID(id)
	if err != nil {
		return httpalerts.Rule{}, httpalerts.ErrInvalidInput
	}
	stored, err := r.repo.GetRule(ctx, key)
	if err != nil {
		return httpalerts.Rule{}, mapAlertError(err)
	}
	return r.viewRule(ctx, stored)
}

func (r alertReader) CreateAlertRule(ctx context.Context, input httpalerts.RuleInput) (httpalerts.Rule, error) {
	id, err := newAlertID()
	if err != nil {
		return httpalerts.Rule{}, err
	}
	stored, err := r.service.CreateRule(ctx, alertRuleFromInput(id, input))
	if err != nil {
		return httpalerts.Rule{}, httpalerts.ErrInvalidInput
	}
	if err := r.saveParameters(ctx, id, *input.Parameters); err != nil {
		return httpalerts.Rule{}, err
	}
	return r.viewRule(ctx, stored)
}

func (r alertReader) UpdateAlertRule(ctx context.Context, id string, input httpalerts.RuleInput, expected int64) (httpalerts.Rule, error) {
	key, err := shared.NewAlertID(id)
	if err != nil {
		return httpalerts.Rule{}, httpalerts.ErrInvalidInput
	}
	stored, err := r.service.UpdateRule(ctx, alertRuleFromInput(key, input), expected)
	if err != nil {
		return httpalerts.Rule{}, mapAlertError(err)
	}
	if err := r.saveParameters(ctx, key, *input.Parameters); err != nil {
		return httpalerts.Rule{}, err
	}
	return r.viewRule(ctx, stored)
}

func (r alertReader) DeleteAlertRule(ctx context.Context, id string, expected int64) error {
	key, err := shared.NewAlertID(id)
	if err != nil || expected < 1 {
		return httpalerts.ErrInvalidInput
	}
	collection := r.db.Collection("alert_rules")
	result, err := collection.DeleteOne(ctx, bson.D{{Key: "_id", Value: string(key)}, {Key: "revision", Value: expected}})
	if err != nil {
		return err
	}
	if result.DeletedCount == 0 {
		if _, err := r.repo.GetRule(ctx, key); errors.Is(err, alertapp.ErrNotFound) {
			return httpalerts.ErrNotFound
		}
		return httpalerts.ErrConflict
	}
	_, _ = r.db.Collection("alert_rule_configs").DeleteOne(ctx, bson.D{{Key: "_id", Value: string(key)}})
	_, _ = r.db.Collection("alert_states").DeleteMany(ctx, bson.D{{Key: "rule_id", Value: string(key)}})
	return nil
}

func (r alertReader) ListAlertEvents(ctx context.Context, cursor string, limit int) (httpalerts.EventPage, error) {
	rules, err := r.service.ListRules(ctx, "", 101)
	if err != nil {
		return httpalerts.EventPage{}, err
	}
	if rules.Next.Valid {
		return httpalerts.EventPage{}, errors.New("alert event listing exceeds the local composition limit")
	}
	items := make([]alertapp.StoredEvent, 0)
	for _, rule := range rules.Items {
		// The notifications panel only lists outstanding events. Filtering in
		// the persisted read path keeps an acknowledged notification dismissed
		// when the page is reloaded.
		page, err := r.service.ListEvents(ctx, alertapp.EventQuery{RuleID: shared.Some(rule.Rule.ID), Acknowledged: shared.Some(false), After: cursor, Limit: alertapp.MaxPageSize})
		if err != nil {
			return httpalerts.EventPage{}, err
		}
		items = append(items, page.Items...)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Event.ID < items[j].Event.ID })
	page := httpalerts.EventPage{Items: make([]httpalerts.Event, 0, limit)}
	for i, stored := range items {
		if i == limit {
			page.NextCursor = stringPtr(page.Items[len(page.Items)-1].ID)
			break
		}
		item, err := r.viewEvent(ctx, stored)
		if err != nil {
			return httpalerts.EventPage{}, err
		}
		page.Items = append(page.Items, item)
	}
	return page, nil
}

func (r alertReader) AcknowledgeAlertEvent(ctx context.Context, id string) error {
	_, err := r.service.Acknowledge(ctx, id)
	return mapAlertError(err)
}

func (r alertReader) viewRule(ctx context.Context, stored alertapp.StoredRule) (httpalerts.Rule, error) {
	item := httpalerts.Rule{ID: string(stored.Rule.ID), Name: stored.Rule.Name, Enabled: stored.Rule.Enabled, Condition: string(stored.Rule.Condition), CooldownSeconds: int64(stored.Rule.Cooldown / time.Second), IncludeBackfill: stored.Rule.IncludeBackfill, Parameters: map[string]any{}, Revision: stored.Revision}
	var config alertRuleParameters
	err := r.db.Collection("alert_rule_configs").FindOne(ctx, bson.D{{Key: "_id", Value: string(stored.Rule.ID)}}).Decode(&config)
	if err != nil && !errors.Is(err, driver.ErrNoDocuments) {
		return httpalerts.Rule{}, err
	}
	if config.Parameters != nil {
		item.Parameters = config.Parameters
	}
	return item, nil
}

func (r alertReader) saveParameters(ctx context.Context, id shared.AlertID, parameters map[string]any) error {
	if parameters == nil {
		parameters = map[string]any{}
	}
	_, err := r.db.Collection("alert_rule_configs").ReplaceOne(ctx, bson.D{{Key: "_id", Value: string(id)}}, alertRuleParameters{ID: string(id), Parameters: parameters}, options.Replace().SetUpsert(true))
	return err
}

func alertRuleFromInput(id shared.AlertID, input httpalerts.RuleInput) corealert.AlertRule {
	return corealert.AlertRule{ID: id, Name: *input.Name, Enabled: *input.Enabled, Condition: corealert.ConditionKind(*input.Condition), Cooldown: time.Duration(*input.CooldownSeconds) * time.Second, IncludeBackfill: *input.IncludeBackfill}
}

func (r alertReader) viewEvent(ctx context.Context, stored alertapp.StoredEvent) (httpalerts.Event, error) {
	event := stored.Event
	var metadata alertEventMetadata
	if err := r.db.Collection("alert_event_metadata").FindOne(ctx, bson.D{{Key: "_id", Value: event.ID}}).Decode(&metadata); err != nil && !errors.Is(err, driver.ErrNoDocuments) {
		return httpalerts.Event{}, err
	}
	emittedAt := metadata.EmittedAt
	if emittedAt.IsZero() {
		// Pre-existing event rows do not contain an emission timestamp. Use the
		// only persisted time evidence rather than inventing a read-time value.
		emittedAt = event.ObservedAt.Time
	}
	item := httpalerts.Event{ID: event.ID, RuleID: string(event.RuleID), Condition: string(event.Condition), ObservedAt: event.ObservedAt.Time, EmittedAt: emittedAt.UTC(), Backfill: event.Backfill, Evidence: event.Evidence}
	if event.Subject.AircraftID.Valid {
		item.AircraftID = stringPtr(string(event.Subject.AircraftID.Value))
	}
	if event.Subject.FlightID.Valid {
		item.FlightID = stringPtr(string(event.Subject.FlightID.Value))
	}
	return item, nil
}

func mapAlertError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, alertapp.ErrNotFound):
		return httpalerts.ErrNotFound
	case errors.Is(err, alertapp.ErrConflict):
		return httpalerts.ErrConflict
	default:
		return err
	}
}

func newAlertID() (shared.AlertID, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("generate alert rule ID: %w", err)
	}
	return shared.AlertID("alert-" + hex.EncodeToString(raw[:])), nil
}
