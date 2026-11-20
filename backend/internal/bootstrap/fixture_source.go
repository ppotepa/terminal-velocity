package bootstrap

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	decodeapp "github.com/ppotepa/terminal-velocity/backend/internal/application/decoding"
	"github.com/ppotepa/terminal-velocity/backend/internal/application/events"
	messageapp "github.com/ppotepa/terminal-velocity/backend/internal/application/messages"
	trackingapp "github.com/ppotepa/terminal-velocity/backend/internal/application/tracking"
	watchapp "github.com/ppotepa/terminal-velocity/backend/internal/application/watchlist"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/communications"
	coredecode "github.com/ppotepa/terminal-velocity/backend/internal/core/decoding"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/flight"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/watch"
	"github.com/ppotepa/terminal-velocity/backend/internal/ports/sources"
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
		callsign += "42"
	}
	if callsign == "" {
		return sources.FetchResult{}, errors.New("synthetic fixture requires a bounded callsign")
	}
	now := time.Now().UTC().Truncate(time.Minute)
	id := fixtureICAO24(callsign)
	sum := sha256.Sum256([]byte(callsign))
	lat := 49.0 + float64(sum[0])/255*5
	lon := -8.0 + float64(sum[1])/255*15
	value := fixtureObservation{Callsign: callsign, ICAO24: string(id), Latitude: lat, Longitude: lon, AltitudeMeters: 9800, GroundSpeedMPS: 225, HeadingDegrees: 90, ObservedAt: now, MessageText: "Q0 " + callsign + " MESSAGE: SYNTHETIC FIXTURE FLIGHT UPDATE"}
	payload, err := json.Marshal(value)
	if err != nil {
		return sources.FetchResult{}, err
	}
	return sources.FetchResult{Records: []sources.Record{{ObservedAt: now, Payload: payload}}, CheckpointToken: now.Format(time.RFC3339)}, nil
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
	rules    *watchapp.Service
	tracking *trackingapp.Service
	messages *messageapp.Service
	decoders *decodeapp.Service
	hub      *events.Hub
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
	observed, err := shared.NewObservationTime(item.ObservedAt, time.Minute, 0)
	if err != nil {
		return err
	}
	if positions {
		_, advanced, err := c.tracking.Ingest(ctx, trackingapp.IngestRequest{AircraftID: aircraftID, FlightID: shared.Some(flightID), Observation: flight.PositionObservation{SourceObservationID: fixtureSourceObservationID(q.Key, item.ObservedAt.Unix()/60), Source: "synthetic-fixture", ObservedAt: observed, Latitude: item.Latitude, Longitude: item.Longitude, AltitudeMeters: shared.Some(item.AltitudeMeters), GroundSpeedMPS: shared.Some(item.GroundSpeedMPS), HeadingDegrees: shared.Some(item.HeadingDegrees)}, QualityRank: 50, ReceivedAt: time.Now().UTC()})
		if err != nil {
			return err
		}
		if advanced {
			sourceTime := item.ObservedAt.UTC()
			c.hub.Publish(events.Event{Type: "position_updated", OccurredAt: time.Now().UTC(), SourceObservedAt: &sourceTime, Data: map[string]any{"aircraftId": aircraftID, "flightId": flightID, "position": map[string]any{"latitude": item.Latitude, "longitude": item.Longitude, "observedAt": item.ObservedAt, "source": "synthetic-fixture"}}, ScopeActive: true})
		}
	}
	if len(messageRuleIDs) > 0 && c.messages != nil {
		icao, _ := shared.NewICAO24(item.ICAO24)
		call, _ := shared.NewCallsign(item.Callsign)
		reference := fmt.Sprintf("fixture:%s:%s:%d", q.Key, strings.Join(q.RuleIDs, ","), item.ObservedAt.Unix()/60)
		message := communications.AircraftMessage{Source: "synthetic-fixture", SourceMessageRef: shared.Some(reference), ObservedAt: shared.Some(observed), CollectedAt: time.Now().UTC(), Direction: communications.DirectionDownlink, Bearer: communications.BearerVHF, Protocol: "acars", ContentStatus: communications.ContentProviderDecoded, OriginalText: item.MessageText, Hints: communications.IdentifierHints{ICAO24: shared.Some(icao), Callsign: shared.Some(call)}}
		ingested, err := c.messages.Ingest(ctx, messageapp.IngestRequest{Message: message, WatchRuleIDs: messageRuleIDs, Policy: messageapp.StoragePolicy{AllowMetadata: true, AllowOriginalText: true}})
		if err != nil {
			return err
		}
		if ingested.Created {
			sourceTime := item.ObservedAt.UTC()
			c.hub.Publish(events.Event{Type: "message_observed", OccurredAt: time.Now().UTC(), SourceObservedAt: &sourceTime, Data: map[string]any{"messageId": ingested.Record.Message.ID, "aircraftId": aircraftID, "flightId": flightID}, ScopeActive: true})
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
			}
		}
	}
	return nil
}
