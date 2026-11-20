// Package communications models logical messages and their source provenance.
// Provider-decoded content is not represented as an RF reception unless the
// source supplied independent reception evidence.
package communications

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

type Direction string

const (
	DirectionUplink   Direction = "uplink"
	DirectionDownlink Direction = "downlink"
	DirectionUnknown  Direction = "unknown"
)

type Bearer string

const (
	BearerHF      Bearer = "hf"
	BearerVHF     Bearer = "vhf"
	BearerSATCOM  Bearer = "satcom"
	BearerUnknown Bearer = "unknown"
)

type ContentStatus string

const (
	ContentProviderDecoded ContentStatus = "provider_decoded"
	ContentRaw             ContentStatus = "raw"
	ContentEncrypted       ContentStatus = "encrypted"
	ContentUnavailable     ContentStatus = "unavailable"
)

type IdentifierHints struct {
	ICAO24       shared.Optional[shared.ICAO24]       `json:"icao24,omitempty"`
	Registration shared.Optional[shared.Registration] `json:"registration,omitempty"`
	Callsign     shared.Optional[shared.Callsign]     `json:"callsign,omitempty"`
}

// RFReception is optional and can be populated only when an actual receiver
// supplied frame and reception metadata. Provider text alone is not RF evidence.
type RFReception struct {
	ReceiverID  string                  `json:"receiver_id"`
	Frame       []byte                  `json:"frame"`
	ReceivedAt  shared.ObservationTime  `json:"received_at"`
	FrequencyHz shared.Optional[uint64] `json:"frequency_hz,omitempty"`
}

func NewRFReception(r RFReception) (RFReception, error) {
	if strings.TrimSpace(r.ReceiverID) == "" || len(r.ReceiverID) > 128 {
		return RFReception{}, shared.NewDomainError(shared.ErrInvalidInput, "receiver identity is required")
	}
	if len(r.Frame) == 0 {
		return RFReception{}, shared.NewDomainError(shared.ErrInvalidInput, "RF frame bytes are required")
	}
	if r.ReceivedAt.Time.IsZero() {
		return RFReception{}, shared.NewDomainError(shared.ErrInvalidInput, "RF reception time is required")
	}
	if r.FrequencyHz.Valid && r.FrequencyHz.Value == 0 {
		return RFReception{}, shared.NewDomainError(shared.ErrOutOfRange, "frequency must be positive when present")
	}
	r.Frame = append([]byte(nil), r.Frame...)
	r.ReceivedAt.Time = r.ReceivedAt.Time.UTC()
	return r, nil
}

type AircraftMessage struct {
	ID               shared.MessageID                        `json:"id"`
	Source           shared.SourceID                         `json:"source"`
	SourceMessageRef shared.Optional[string]                 `json:"source_message_ref,omitempty"`
	ObservedAt       shared.Optional[shared.ObservationTime] `json:"observed_at,omitempty"`
	CollectedAt      time.Time                               `json:"collected_at"`
	Direction        Direction                               `json:"direction"`
	Bearer           Bearer                                  `json:"bearer"`
	Protocol         string                                  `json:"protocol"`
	ContentStatus    ContentStatus                           `json:"content_status"`
	OriginalText     string                                  `json:"original_text,omitempty"`
	Hints            IdentifierHints                         `json:"hints"`
	Reception        shared.Optional[RFReception]            `json:"reception,omitempty"`
}

func NewAircraftMessage(m AircraftMessage) (AircraftMessage, error) {
	if _, err := shared.NewMessageID(string(m.ID)); err != nil {
		return AircraftMessage{}, fmt.Errorf("message id: %w", err)
	}
	if _, err := shared.NewSourceID(string(m.Source)); err != nil {
		return AircraftMessage{}, fmt.Errorf("message source: %w", err)
	}
	if m.CollectedAt.IsZero() {
		return AircraftMessage{}, shared.NewDomainError(shared.ErrInvalidInput, "collection time is required")
	}
	m.CollectedAt = m.CollectedAt.UTC()
	if m.ObservedAt.Valid {
		if m.ObservedAt.Value.Time.IsZero() {
			return AircraftMessage{}, shared.NewDomainError(shared.ErrInvalidInput, "observed time cannot be zero when present")
		}
		if m.ObservedAt.Value.Precision < 0 || m.ObservedAt.Value.Uncertainty < 0 {
			return AircraftMessage{}, shared.NewDomainError(shared.ErrInvalidInput, "observation precision and uncertainty cannot be negative")
		}
		m.ObservedAt.Value.Time = m.ObservedAt.Value.Time.UTC()
	}
	if m.Hints.ICAO24.Valid {
		value, err := shared.NewICAO24(string(m.Hints.ICAO24.Value))
		if err != nil {
			return AircraftMessage{}, fmt.Errorf("ICAO24 hint: %w", err)
		}
		m.Hints.ICAO24 = shared.Some(value)
	}
	if m.Hints.Registration.Valid {
		value, err := shared.NewRegistration(string(m.Hints.Registration.Value))
		if err != nil {
			return AircraftMessage{}, fmt.Errorf("registration hint: %w", err)
		}
		m.Hints.Registration = shared.Some(value)
	}
	if m.Hints.Callsign.Valid {
		value, err := shared.NewCallsign(string(m.Hints.Callsign.Value))
		if err != nil {
			return AircraftMessage{}, fmt.Errorf("callsign hint: %w", err)
		}
		m.Hints.Callsign = shared.Some(value)
	}
	if m.SourceMessageRef.Valid && (strings.TrimSpace(m.SourceMessageRef.Value) == "" || len(m.SourceMessageRef.Value) > 256) {
		return AircraftMessage{}, shared.NewDomainError(shared.ErrInvalidInput, "source message reference must contain 1-256 characters")
	}
	if m.Direction == "" {
		m.Direction = DirectionUnknown
	}
	if m.Bearer == "" {
		m.Bearer = BearerUnknown
	}
	if m.Direction != DirectionUplink && m.Direction != DirectionDownlink && m.Direction != DirectionUnknown {
		return AircraftMessage{}, shared.NewDomainError(shared.ErrInvalidInput, "unsupported message direction")
	}
	if m.Bearer != BearerHF && m.Bearer != BearerVHF && m.Bearer != BearerSATCOM && m.Bearer != BearerUnknown {
		return AircraftMessage{}, shared.NewDomainError(shared.ErrInvalidInput, "unsupported communication bearer")
	}
	if m.Protocol = strings.TrimSpace(m.Protocol); m.Protocol == "" || len(m.Protocol) > 64 {
		return AircraftMessage{}, shared.NewDomainError(shared.ErrInvalidInput, "protocol must contain 1-64 characters")
	}
	if m.ContentStatus != ContentProviderDecoded && m.ContentStatus != ContentRaw && m.ContentStatus != ContentEncrypted && m.ContentStatus != ContentUnavailable {
		return AircraftMessage{}, shared.NewDomainError(shared.ErrInvalidInput, "unsupported message content status")
	}
	if m.ContentStatus == ContentUnavailable && m.OriginalText != "" {
		return AircraftMessage{}, shared.NewDomainError(shared.ErrInvalidInput, "unavailable content cannot contain fabricated text")
	}
	if m.Reception.Valid {
		r, err := NewRFReception(m.Reception.Value)
		if err != nil {
			return AircraftMessage{}, fmt.Errorf("RF reception: %w", err)
		}
		m.Reception = shared.Some(r)
	}
	return m, nil
}

type MessageIdentity struct {
	Source shared.SourceID `json:"source"`
	Key    string          `json:"key"`
	Method string          `json:"method"`
}

// Identity uses a source-scoped provider reference when available. Otherwise
// it hashes source, observed time, direction, bearer, protocol, status and exact
// original bytes. This intentionally favors missed deduplication over merging
// distinct messages that happen to display the same text.
func (m AircraftMessage) Identity() (MessageIdentity, error) {
	validated, err := NewAircraftMessage(m)
	if err != nil {
		return MessageIdentity{}, err
	}
	if validated.SourceMessageRef.Valid {
		return MessageIdentity{Source: validated.Source, Key: validated.SourceMessageRef.Value, Method: "source_reference"}, nil
	}
	if !validated.ObservedAt.Valid {
		return MessageIdentity{}, shared.NewDomainError(shared.ErrInvalidInput, "observed time is required for fallback message identity")
	}
	h := sha256.New()
	fields := []string{string(validated.Source), validated.ObservedAt.Value.Time.Format(time.RFC3339Nano), validated.ObservedAt.Value.Precision.String(), validated.ObservedAt.Value.Uncertainty.String(), validated.Direction.String(), validated.Bearer.String(), validated.Protocol, string(validated.ContentStatus), validated.OriginalText}
	for _, field := range fields {
		_, _ = fmt.Fprintf(h, "%d:", len(field))
		_, _ = h.Write([]byte(field))
	}
	return MessageIdentity{Source: validated.Source, Key: hex.EncodeToString(h.Sum(nil)), Method: "conservative_fingerprint"}, nil
}

func (d Direction) String() string { return string(d) }
func (b Bearer) String() string    { return string(b) }

type AssociationOutcome string

const (
	AssociationMatched    AssociationOutcome = "matched"
	AssociationUnmatched  AssociationOutcome = "unmatched"
	AssociationAmbiguous  AssociationOutcome = "ambiguous"
	AssociationConflicted AssociationOutcome = "conflicted"
)

type AssociationEvidence struct {
	Kind       string                             `json:"kind"`
	Value      string                             `json:"value"`
	Source     shared.SourceID                    `json:"source"`
	AircraftID shared.Optional[shared.AircraftID] `json:"aircraft_id,omitempty"`
	FlightID   shared.Optional[shared.FlightID]   `json:"flight_id,omitempty"`
	Reason     string                             `json:"reason"`
}

type Association struct {
	Outcome    AssociationOutcome                 `json:"outcome"`
	AircraftID shared.Optional[shared.AircraftID] `json:"aircraft_id,omitempty"`
	FlightID   shared.Optional[shared.FlightID]   `json:"flight_id,omitempty"`
	Candidates []shared.AircraftID                `json:"candidates,omitempty"`
	Evidence   []AssociationEvidence              `json:"evidence"`
}

func NewAssociation(a Association) (Association, error) {
	switch a.Outcome {
	case AssociationMatched:
		if !a.AircraftID.Valid && !a.FlightID.Valid {
			return Association{}, shared.NewDomainError(shared.ErrInvalidInput, "matched association requires an aircraft or flight")
		}
		if a.AircraftID.Valid {
			if _, err := shared.NewAircraftID(string(a.AircraftID.Value)); err != nil {
				return Association{}, err
			}
		}
		if a.FlightID.Valid {
			if _, err := shared.NewFlightID(string(a.FlightID.Value)); err != nil {
				return Association{}, err
			}
		}
	case AssociationUnmatched:
		if a.AircraftID.Valid || a.FlightID.Valid {
			return Association{}, shared.NewDomainError(shared.ErrInvalidInput, "unmatched association cannot identify an aircraft or flight")
		}
	case AssociationAmbiguous, AssociationConflicted:
		if a.AircraftID.Valid || a.FlightID.Valid {
			return Association{}, shared.NewDomainError(shared.ErrInvalidInput, "ambiguous or conflicted association cannot select a winner")
		}
	default:
		return Association{}, shared.NewDomainError(shared.ErrInvalidInput, "unsupported association outcome")
	}
	for i, candidate := range a.Candidates {
		if _, err := shared.NewAircraftID(string(candidate)); err != nil {
			return Association{}, fmt.Errorf("candidate %d: %w", i, err)
		}
	}
	for i, evidence := range a.Evidence {
		if strings.TrimSpace(evidence.Kind) == "" || strings.TrimSpace(evidence.Reason) == "" {
			return Association{}, fmt.Errorf("evidence %d: %w", i, shared.NewDomainError(shared.ErrInvalidInput, "association evidence requires kind and reason"))
		}
		if _, err := shared.NewSourceID(string(evidence.Source)); err != nil {
			return Association{}, fmt.Errorf("evidence %d source: %w", i, err)
		}
	}
	return a, nil
}
