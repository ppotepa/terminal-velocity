package bootstrap

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	alertapp "github.com/ppotepa/terminal-velocity/backend/internal/application/alerting"
	decodeapp "github.com/ppotepa/terminal-velocity/backend/internal/application/decoding"
	"github.com/ppotepa/terminal-velocity/backend/internal/application/events"
	geoapp "github.com/ppotepa/terminal-velocity/backend/internal/application/geography"
	messageapp "github.com/ppotepa/terminal-velocity/backend/internal/application/messages"
	trackingapp "github.com/ppotepa/terminal-velocity/backend/internal/application/tracking"
	watchapp "github.com/ppotepa/terminal-velocity/backend/internal/application/watchlist"
	corealert "github.com/ppotepa/terminal-velocity/backend/internal/core/alerting"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/communications"
	coredecode "github.com/ppotepa/terminal-velocity/backend/internal/core/decoding"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/flight"
	coregeo "github.com/ppotepa/terminal-velocity/backend/internal/core/geography"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/watch"
	"github.com/ppotepa/terminal-velocity/backend/internal/ports/sources"
	"go.mongodb.org/mongo-driver/v2/bson"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type fixtureSource struct{}
type fixtureObservation struct {
	Callsign       string    `json:"callsign"`
	ICAO24         string    `json:"icao24"`
	Latitude       float64   `json:"latitude"`
	Longitude      float64   `json:"longitude"`
	AltitudeMeters float64   `json:"altitudeMeters"`
	GroundSpeedMPS float64   `json:"groundSpeedMps"`
	HeadingDegrees float64   `json:"headingDegrees"`
	ObservedAt     time.Time `json:"observedAt"`
	MessageText    string    `json:"messageText"`
}

func (fixtureSource) Capabilities() sources.Capabilities {
	return sources.Capabilities{ID: "synthetic-fixture", Lookups: []sources.LookupKind{sources.LookupCallsign}, RequestsPerWindow: 720, QuotaWindow: time.Hour, MinimumInterval: time.Second, RequestTimeout: 2 * time.Second, MaxResultsPerRequest: 1, SupportsCallsignPrefix: true}
}
func (fixtureSource) Fetch(ctx context.Context, q sources.Query) (sources.FetchResult, error) {
	if err := ctx.Err(); err != nil {
		return sources.FetchResult{}, err
	}
	if q.Lookup != sources.LookupCallsign {
		return sources.FetchResult{}, errors.New("synthetic fixture supports callsign lookup only")
	}
	callsign := strings.ToUpper(strings.TrimSpace(q.Value))
	if q.Prefix {
		var err error
		callsign, err = fixtureCallsignForPrefix(callsign)
		if err != nil {
			return sources.FetchResult{}, err
		}
	} else if normalized, err := shared.NewCallsign(callsign); err != nil {
		return sources.FetchResult{}, err
	} else {
		callsign = string(normalized)
	}
	if callsign == "" {
		return sources.FetchResult{}, errors.New("synthetic fixture requires a bounded callsign")
	}
	now := time.Now().UTC()
	id := fixtureICAO24(callsign)
	phase := 0
	if q.SinceToken != "" {
		phase, _ = strconv.Atoi(q.SinceToken)
	}
	lat, lon := 51.5, -0.1 // London, United Kingdom.
	if phase%2 == 1 {
		lat, lon = 48.8566, 2.3522 // Paris, France.
	}
	value := fixtureObservation{Callsign: callsign, ICAO24: string(id), Latitude: lat, Longitude: lon, AltitudeMeters: 9800, GroundSpeedMPS: 225, HeadingDegrees: 90, ObservedAt: now, MessageText: "Q0 " + callsign + " MESSAGE: SYNTHETIC FIXTURE FLIGHT UPDATE"}
	payload, err := json.Marshal(value)
	if err != nil {
		return sources.FetchResult{}, err
	}
	return sources.FetchResult{Records: []sources.Record{{ObservedAt: now, Payload: payload}}, CheckpointToken: strconv.Itoa(phase + 1)}, nil
}

type memoryCheckpoints struct{ items map[string]sources.Checkpoint }

func newMemoryCheckpoints() *memoryCheckpoints {
	return &memoryCheckpoints{items: map[string]sources.Checkpoint{}}
}
func (m *memoryCheckpoints) Load(_ context.Context, sourceID, key string) (sources.Checkpoint, bool, error) {
	v, ok := m.items[sourceID+"\x00"+key]
	return v, ok, nil
}
func (m *memoryCheckpoints) Save(_ context.Context, v sources.Checkpoint) error {
	m.items[v.SourceID+"\x00"+v.QueryKey] = v
	return nil
}

type fixtureConsumer struct {
	rules     *watchapp.Service
	tracking  *trackingapp.Service
	messages  *messageapp.Service
	decoders  *decodeapp.Service
	alerts    *alertapp.Service
	geography *geoapp.Service
	db        *driver.Database
	hub       *events.Hub
}

func (c fixtureConsumer) Consume(ctx context.Context, q sources.Query, result sources.FetchResult) error {
	if len(result.Records) == 0 {
		return nil
	}
	var item fixtureObservation
	if err := json.Unmarshal(result.Records[0].Payload, &item); err != nil {
		return errors.New("synthetic fixture record is invalid")
	}
	aircraftID := fixtureAircraftID(item.Callsign)
	flightID := fixtureFlightID(item.Callsign)
	active := []watchapp.StoredRule{}
	messageRuleIDs := []shared.WatchRuleID{}
	decoderSet := map[coredecode.DecoderID]bool{}
	positions := false
	for _, rawID := range q.RuleIDs {
		rule, err := c.rules.Get(ctx, shared.WatchRuleID(rawID))
		if err != nil {
			return fmt.Errorf("load authorized WatchRule: %w", err)
		}
		if rule.Rule.Status != watch.StatusActive {
			continue
		}
		active = append(active, rule)
		if rule.Rule.Collection.Positions {
			positions = true
		}
		if rule.Rule.Collection.Messages {
			messageRuleIDs = append(messageRuleIDs, rule.Rule.ID)
			for _, id := range rule.Rule.Collection.DecoderIDs {
				decoderSet[coredecode.DecoderID(id)] = true
			}
		}
	}
	if len(active) == 0 {
		return nil
	}
	observed, err := shared.NewObservationTime(item.ObservedAt, time.Second, 0)
	if err != nil {
		return err
	}
	if positions {
		_, advanced, err := c.tracking.Ingest(ctx, trackingapp.IngestRequest{AircraftID: aircraftID, FlightID: shared.Some(flightID), Observation: flight.PositionObservation{SourceObservationID: fixtureSourceObservationID(q.Key, item.ObservedAt.UnixNano()), Source: "synthetic-fixture", ObservedAt: observed, Latitude: item.Latitude, Longitude: item.Longitude, AltitudeMeters: shared.Some(item.AltitudeMeters), GroundSpeedMPS: shared.Some(item.GroundSpeedMPS), HeadingDegrees: shared.Some(item.HeadingDegrees)}, QualityRank: 50, ReceivedAt: time.Now().UTC()})
		if err != nil {
			return err
		}
		if advanced {
			sourceTime := item.ObservedAt.UTC()
			c.hub.Publish(events.Event{Type: "position_updated", OccurredAt: time.Now().UTC(), SourceObservedAt: &sourceTime, Data: map[string]any{"aircraftId": aircraftID, "flightId": flightID, "position": map[string]any{"latitude": item.Latitude, "longitude": item.Longitude, "observedAt": item.ObservedAt, "source": "synthetic-fixture"}}, ScopeActive: true})
			if err := c.evaluateFixtureAlerts(ctx, aircraftID, flightID, observed, corealert.ConditionAircraftDetected, fixtureSourceObservationID(q.Key, item.ObservedAt.UnixNano()), "", ""); err != nil {
				return err
			}
			if err := c.evaluateFixtureAlerts(ctx, aircraftID, flightID, observed, corealert.ConditionFlightStarted, fixtureSourceObservationID(q.Key, item.ObservedAt.UnixNano()), "", ""); err != nil {
				return err
			}
			if err := c.evaluateCountryCrossing(ctx, aircraftID, flightID, observed); err != nil {
				return err
			}
		}
	}
	if len(messageRuleIDs) > 0 && c.messages != nil {
		icao, _ := shared.NewICAO24(item.ICAO24)
		call, _ := shared.NewCallsign(item.Callsign)
		reference := fmt.Sprintf("fixture:%s:%s:%d", q.Key, strings.Join(q.RuleIDs, ","), item.ObservedAt.UnixNano())
		message := communications.AircraftMessage{Source: "synthetic-fixture", SourceMessageRef: shared.Some(reference), ObservedAt: shared.Some(observed), CollectedAt: time.Now().UTC(), Direction: communications.DirectionDownlink, Bearer: communications.BearerVHF, Protocol: "acars", ContentStatus: communications.ContentProviderDecoded, OriginalText: item.MessageText, Hints: communications.IdentifierHints{ICAO24: shared.Some(icao), Callsign: shared.Some(call)}}
		ingested, err := c.messages.Ingest(ctx, messageapp.IngestRequest{Message: message, WatchRuleIDs: messageRuleIDs, Policy: messageapp.StoragePolicy{AllowMetadata: true, AllowOriginalText: true}})
		if err != nil {
			return err
		}
		if ingested.Created {
			sourceTime := item.ObservedAt.UTC()
			c.hub.Publish(events.Event{Type: "message_observed", OccurredAt: time.Now().UTC(), SourceObservedAt: &sourceTime, Data: map[string]any{"messageId": ingested.Record.Message.ID, "aircraftId": aircraftID, "flightId": flightID}, ScopeActive: true})
			if err := c.evaluateFixtureAlerts(ctx, aircraftID, flightID, observed, corealert.ConditionMessageObserved, string(ingested.Record.Message.ID), "", ""); err != nil {
				return err
			}
			selected := make([]coredecode.DecoderID, 0, len(decoderSet))
			for id := range decoderSet {
				selected = append(selected, id)
			}
			decoded, err := c.decoders.Decode(ctx, decodeapp.DecodeRequest{Message: ingested.Record.Message, SelectedDecoderIDs: selected})
			if err != nil {
				return err
			}
			if len(decoded.Results) > 0 {
				c.hub.Publish(events.Event{Type: "message_decoded", OccurredAt: time.Now().UTC(), SourceObservedAt: &sourceTime, Data: map[string]any{"messageId": ingested.Record.Message.ID, "aircraftId": aircraftID, "resultCount": len(decoded.Results)}, ScopeActive: true})
				if err := c.evaluateFixtureAlerts(ctx, aircraftID, flightID, observed, corealert.ConditionMessageDecoded, string(ingested.Record.Message.ID), "", ""); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func (c fixtureConsumer) evaluateFixtureAlerts(ctx context.Context, aircraft shared.AircraftID, flight shared.FlightID, at shared.ObservationTime, condition corealert.ConditionKind, sourceEventID, country, crossing string) error {
	if c.alerts == nil {
		return nil
	}
	page, err := c.alerts.ListRules(ctx, "", alertapp.MaxPageSize)
	if err != nil {
		return err
	}
	for _, stored := range page.Items {
		if !stored.Rule.Enabled || stored.Rule.Condition != condition {
			continue
		}
		eventID := "fixture:" + sourceEventID + ":" + string(stored.Rule.ID) + ":" + string(condition)
		observation, _, err := fixtureAlertObservation(stored.Rule.ID, condition, aircraft, flight, at, eventID, country, crossing)
		if err != nil {
			return err
		}
		result, err := c.alerts.Evaluate(ctx, stored.Rule.ID, observation)
		if err != nil {
			return err
		}
		if result.Event.Valid {
			event := result.Event.Value.Event
			occurredAt := event.ObservedAt.Time
			emittedAt := time.Now().UTC()
			if c.db != nil {
				_, err := c.db.Collection("alert_event_metadata").ReplaceOne(ctx, bson.D{{Key: "_id", Value: event.ID}}, bson.D{{Key: "_id", Value: event.ID}, {Key: "emitted_at", Value: emittedAt}}, options.Replace().SetUpsert(true))
				if err != nil {
					return err
				}
			}
			c.hub.Publish(events.Event{Type: "alert_triggered", OccurredAt: time.Now().UTC(), SourceObservedAt: &occurredAt, Data: map[string]any{"eventId": event.ID, "ruleId": event.RuleID, "condition": event.Condition, "aircraftId": aircraft, "flightId": flight, "evidence": event.Evidence}, ScopeActive: true})
		}
	}
	return nil
}

func (c fixtureConsumer) evaluateCountryCrossing(ctx context.Context, aircraft shared.AircraftID, flight shared.FlightID, at shared.ObservationTime) error {
	if c.geography == nil || c.alerts == nil {
		return nil
	}
	page, err := c.tracking.FlightTrack(ctx, flight, at.Time.Add(-15*time.Minute), at.Time.Add(time.Minute), nil, 500)
	if err != nil {
		return err
	}
	track := make([]shared.Optional[coregeo.Observation], 0)
	for _, segment := range page.Segments {
		for _, point := range segment.Points {
			observation := point.Observation
			track = append(track, shared.Some(coregeo.Observation{Point: coregeo.GeoPoint{Latitude: observation.Latitude, Longitude: observation.Longitude}, At: observation.ObservedAt}))
		}
	}
	if len(track) < 2 {
		return nil
	}
	for _, crossing := range c.geography.EntryEvents(aircraft, shared.Some(flight), track) {
		status := string(crossing.Evidence.Status)
		if (status != string(coregeo.CrossingObserved) && status != string(coregeo.CrossingInferred)) || !crossing.Evidence.At.Valid {
			continue
		}
		if err := c.evaluateFixtureAlerts(ctx, aircraft, flight, crossing.Evidence.At.Value, corealert.ConditionCountryEntered, crossing.Evidence.EventKey, string(crossing.Country), status); err != nil {
			return err
		}
	}
	return nil
}
