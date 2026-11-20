package communications

import (
	"testing"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

func messageAt(seconds int) shared.ObservationTime {
	at, _ := shared.NewObservationTime(time.Date(2025, 3, 1, 12, 0, seconds, 0, time.UTC), time.Second, 0)
	return at
}

func baseMessage() AircraftMessage {
	return AircraftMessage{ID: "message-1", Source: "airframes", ObservedAt: shared.Some(messageAt(0)), CollectedAt: time.Date(2025, 3, 1, 12, 1, 0, 0, time.UTC), Direction: DirectionDownlink, Bearer: BearerVHF, Protocol: "ACARS", ContentStatus: ContentProviderDecoded, OriginalText: "TEST MESSAGE"}
}

func TestProviderDecodedMessageNeedsNoRFReception(t *testing.T) {
	m, err := NewAircraftMessage(baseMessage())
	if err != nil {
		t.Fatal(err)
	}
	if m.Reception.Valid {
		t.Fatal("provider decoded content fabricated RF reception evidence")
	}
}

func TestFallbackIdentityIncludesObservedTimeAndSource(t *testing.T) {
	one := baseMessage()
	identity1, err := one.Identity()
	if err != nil {
		t.Fatal(err)
	}
	two := one
	two.ID = "message-2"
	two.ObservedAt = shared.Some(messageAt(1))
	identity2, err := two.Identity()
	if err != nil {
		t.Fatal(err)
	}
	if identity1.Key == identity2.Key {
		t.Fatal("same text observed at distinct times was merged")
	}
	two = one
	two.Source = "another-source"
	identity3, err := two.Identity()
	if err != nil {
		t.Fatal(err)
	}
	if identity1.Source == identity3.Source || identity1.Key == identity3.Key {
		t.Fatal("fallback identity was not source scoped")
	}
	ref := one
	ref.SourceMessageRef = shared.Some("provider-42")
	refIdentity, err := ref.Identity()
	if err != nil {
		t.Fatal(err)
	}
	if refIdentity.Method != "source_reference" || refIdentity.Key != "provider-42" {
		t.Fatalf("source reference not used: %+v", refIdentity)
	}
}

func TestUnknownObservationRequiresReferenceForIdentity(t *testing.T) {
	m := baseMessage()
	m.ObservedAt = shared.None[shared.ObservationTime]()
	if _, err := m.Identity(); err == nil {
		t.Fatal("created fallback identity without observed-time evidence")
	}
	m.SourceMessageRef = shared.Some("provider-1")
	if _, err := m.Identity(); err != nil {
		t.Fatalf("source reference should identify time-unknown message: %v", err)
	}
}

func TestAssociationPreservesAmbiguityAndRejectsFalseWinner(t *testing.T) {
	a := Association{Outcome: AssociationAmbiguous, Candidates: []shared.AircraftID{"aircraft-1", "aircraft-2"}, Evidence: []AssociationEvidence{{Kind: "icao24", Value: "A1B2C3", Source: "airframes", Reason: "multiple time-valid assertions"}}}
	if _, err := NewAssociation(a); err != nil {
		t.Fatal(err)
	}
	a.AircraftID = shared.Some(shared.AircraftID("aircraft-1"))
	if _, err := NewAssociation(a); err == nil {
		t.Fatal("ambiguous association selected a winner")
	}
	matched := Association{Outcome: AssociationMatched, FlightID: shared.Some(shared.FlightID("flight-1")), Evidence: []AssociationEvidence{{Kind: "flight", Value: "flight-1", Source: "decoder", Reason: "flight identifier match"}}}
	if _, err := NewAssociation(matched); err != nil {
		t.Fatalf("flight match may exist without physical aircraft identity: %v", err)
	}
}

func TestUnavailableContentCannotInventPlaintext(t *testing.T) {
	m := baseMessage()
	m.ContentStatus = ContentUnavailable
	if _, err := NewAircraftMessage(m); err == nil {
		t.Fatal("accepted text for unavailable content")
	}
	m.OriginalText = ""
	if _, err := NewAircraftMessage(m); err != nil {
		t.Fatal(err)
	}
}

func TestActualReceptionRequiresFrameAndReceiverEvidence(t *testing.T) {
	m := baseMessage()
	m.Reception = shared.Some(RFReception{ReceiverID: "rx-1", Frame: []byte{0x01, 0x02}, ReceivedAt: messageAt(0), FrequencyHz: shared.Some(uint64(131550000))})
	if _, err := NewAircraftMessage(m); err != nil {
		t.Fatal(err)
	}
	m.Reception = shared.Some(RFReception{ReceiverID: "rx-1", ReceivedAt: messageAt(0)})
	if _, err := NewAircraftMessage(m); err == nil {
		t.Fatal("accepted reception without actual frame bytes")
	}
}

func TestIdentifierHintsAreValidatedAndNormalized(t *testing.T) {
	m := baseMessage()
	m.Hints.ICAO24 = shared.Some(shared.ICAO24("a1b2c3"))
	got, err := NewAircraftMessage(m)
	if err != nil || got.Hints.ICAO24.Value != "A1B2C3" {
		t.Fatalf("hint not normalized: %+v %v", got.Hints, err)
	}
	m.Hints.ICAO24 = shared.Some(shared.ICAO24("bad"))
	if _, err := NewAircraftMessage(m); err == nil {
		t.Fatal("accepted malformed ICAO24 hint")
	}
}
