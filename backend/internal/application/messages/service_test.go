package messages

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/aircraft"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/communications"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/flight"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

type memoryRepo struct{ items map[string]Record }

func (r *memoryRepo) Insert(_ context.Context, v Record) (Record, bool, error) {
	if r.items == nil {
		r.items = map[string]Record{}
	}
	k := string(v.Identity.Source) + "/" + v.Identity.Key
	if old, ok := r.items[k]; ok {
		if old.PayloadDigest != v.PayloadDigest {
			return Record{}, false, ErrConflict
		}
		return old, false, nil
	}
	r.items[k] = v
	return v, true, nil
}
func (r *memoryRepo) List(_ context.Context, q Query) ([]Record, bool, error) {
	out := []Record{}
	for _, v := range r.items {
		match := q.AircraftID.Valid && v.Association.AircraftID == q.AircraftID || q.FlightID.Valid && v.Association.FlightID == q.FlightID
		if q.WatchRuleID.Valid {
			for _, id := range v.WatchRuleIDs {
				if id == q.WatchRuleID.Value {
					match = true
				}
			}
		}
		if match {
			out = append(out, v)
		}
	}
	if len(out) > q.Limit {
		return out[:q.Limit], true, nil
	}
	return out, false, nil
}
func fixtureMessage(ref, text string, observed time.Time) communications.AircraftMessage {
	return communications.AircraftMessage{ID: "upstream-id", Source: "fixture", SourceMessageRef: shared.Some(ref), ObservedAt: shared.Some(shared.ObservationTime{Time: observed}), CollectedAt: observed.Add(time.Minute), Direction: communications.DirectionUplink, Bearer: communications.BearerHF, Protocol: "acars", ContentStatus: communications.ContentProviderDecoded, OriginalText: text}
}

type matchingCorrelator struct {
	fleet   []aircraft.Aircraft
	flights []flight.Flight
}

func (c matchingCorrelator) AircraftCandidates(context.Context, []aircraft.IdentifierHint, shared.Optional[shared.ObservationTime], int) ([]aircraft.Aircraft, error) {
	return c.fleet, nil
}
func (c matchingCorrelator) FlightCandidates(context.Context, shared.AircraftID, shared.Optional[shared.Callsign], shared.ObservationTime, int) ([]flight.Flight, error) {
	return c.flights, nil
}
func TestIngestDeduplicatesBySourceReferenceAndConflictsOnChangedPayload(t *testing.T) {
	repo := &memoryRepo{}
	svc := NewService(repo, nil)
	now := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	req := IngestRequest{Message: fixtureMessage("delivery-1", "hello", now), WatchRuleIDs: []shared.WatchRuleID{"rule1"}, Policy: StoragePolicy{AllowMetadata: true, AllowOriginalText: true}}
	first, e := svc.Ingest(context.Background(), req)
	if e != nil || !first.Created {
		t.Fatalf("first=%+v err=%v", first, e)
	}
	req.Message.CollectedAt = req.Message.CollectedAt.Add(time.Hour)
	dup, e := svc.Ingest(context.Background(), req)
	if e != nil || dup.Created || dup.Record.Message.ID != first.Record.Message.ID {
		t.Fatalf("duplicate=%+v err=%v", dup, e)
	}
	req.Message.OriginalText = "different"
	_, e = svc.Ingest(context.Background(), req)
	if !errors.Is(e, ErrConflict) {
		t.Fatalf("changed payload err=%v", e)
	}
}
func TestIngestPreservesDistinctDeliveriesAndRedactsDisallowedText(t *testing.T) {
	repo := &memoryRepo{}
	svc := NewService(repo, nil)
	now := time.Now().UTC()
	policy := StoragePolicy{AllowMetadata: true}
	for _, ref := range []string{"delivery-a", "delivery-b"} {
		result, err := svc.Ingest(context.Background(), IngestRequest{Message: fixtureMessage(ref, "secret", now), WatchRuleIDs: []shared.WatchRuleID{"rule1"}, Policy: policy})
		if err != nil {
			t.Fatal(err)
		}
		if result.Record.Message.OriginalText != "" || result.Record.Message.ContentStatus != communications.ContentUnavailable {
			t.Fatalf("content retained: %+v", result.Record.Message)
		}
	}
	page, err := svc.History(context.Background(), Query{WatchRuleID: shared.Some(shared.WatchRuleID("rule1"))})
	if err != nil || len(page.Items) != 2 {
		t.Fatalf("page=%+v err=%v", page, err)
	}
}
func TestUnmatchedMessageDoesNotInventPositionAndHistoryRequiresScope(t *testing.T) {
	svc := NewService(&memoryRepo{}, nil)
	now := time.Now().UTC()
	got, err := svc.Ingest(context.Background(), IngestRequest{Message: fixtureMessage("delivery", "text", now), WatchRuleIDs: []shared.WatchRuleID{"rule1"}, Policy: StoragePolicy{AllowMetadata: true, AllowOriginalText: true}})
	if err != nil {
		t.Fatal(err)
	}
	if got.Record.Association.Outcome != communications.AssociationUnmatched || got.Record.Association.AircraftID.Valid || got.Record.Association.FlightID.Valid || got.Record.Message.Reception.Valid {
		t.Fatalf("fabricated association/reception: %+v", got.Record)
	}
	if _, err := svc.History(context.Background(), Query{}); !errors.Is(err, ErrInvalidQuery) {
		t.Fatalf("unfiltered history err=%v", err)
	}
}

func TestIngestCorrelatesTimeQualifiedIdentityAndCallsignFlight(t *testing.T) {
	at := time.Date(2026, 2, 3, 4, 5, 6, 0, time.UTC)
	aircraftID := shared.AircraftID("aircraft-1")
	flightID := shared.FlightID("flight-1")
	evidence := shared.Evidence{Source: "registry", ObservedAt: shared.ObservationTime{Time: at.Add(-time.Hour)}}
	fleetItem, err := aircraft.NewAircraft(aircraftID, []aircraft.IdentifierAssertion{{Kind: aircraft.IdentifierICAO24, Value: "ABC123", ValidFrom: at.Add(-time.Hour), Evidence: evidence}})
	if err != nil {
		t.Fatal(err)
	}
	f := flight.Flight{ID: flightID, AircraftID: shared.Some(aircraftID), Callsign: shared.Some(shared.Callsign("TV123")), StartedAt: shared.Some(flight.BoundaryEvidence{At: shared.ObservationTime{Time: at.Add(-time.Minute)}, Source: "positions", Reason: "observed start"}), EndedAt: shared.Some(flight.BoundaryEvidence{At: shared.ObservationTime{Time: at.Add(time.Minute)}, Source: "positions", Reason: "observed end"})}
	svc := NewService(&memoryRepo{}, matchingCorrelator{fleet: []aircraft.Aircraft{fleetItem}, flights: []flight.Flight{f}})
	m := fixtureMessage("delivery", "text", at)
	m.Hints.ICAO24 = shared.Some(shared.ICAO24("ABC123"))
	m.Hints.Callsign = shared.Some(shared.Callsign("TV123"))
	got, err := svc.Ingest(context.Background(), IngestRequest{Message: m, WatchRuleIDs: []shared.WatchRuleID{"r1"}, Policy: StoragePolicy{AllowMetadata: true, AllowOriginalText: true}})
	if err != nil {
		t.Fatal(err)
	}
	if got.Record.Association.Outcome != communications.AssociationMatched || got.Record.Association.AircraftID.Value != aircraftID || !got.Record.Association.FlightID.Valid || got.Record.Association.FlightID.Value != flightID {
		t.Fatalf("association=%+v", got.Record.Association)
	}
}
