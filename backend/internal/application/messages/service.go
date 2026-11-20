// Package messages ingests source-neutral aircraft messages and exposes bounded history.
package messages

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/aircraft"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/communications"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/flight"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

var (
	ErrConflict     = errors.New("message identity reused with different source evidence")
	ErrInvalidQuery = errors.New("message history query requires a filter and a valid limit")
)

const (
	DefaultPageSize          = 50
	MaxPageSize              = 200
	MaxWatchRules            = 100
	MaxCorrelationCandidates = 100
)

type StoragePolicy struct {
	AllowMetadata     bool
	AllowOriginalText bool
	AllowRFReception  bool
}
type Record struct {
	Identity      communications.MessageIdentity `json:"identity" bson:"identity"`
	PayloadDigest string                         `json:"payload_digest" bson:"payload_digest"`
	Message       communications.AircraftMessage `json:"message" bson:"message"`
	Association   communications.Association     `json:"association" bson:"association"`
	WatchRuleIDs  []shared.WatchRuleID           `json:"watch_rule_ids" bson:"watch_rule_ids"`
	SortAt        time.Time                      `json:"sort_at" bson:"sort_at"`
	CreatedAt     time.Time                      `json:"created_at" bson:"created_at"`
}
type Cursor struct {
	SortAt time.Time `json:"sort_at"`
	ID     string    `json:"id"`
}
type Query struct {
	AircraftID  shared.Optional[shared.AircraftID]
	FlightID    shared.Optional[shared.FlightID]
	WatchRuleID shared.Optional[shared.WatchRuleID]
	After       shared.Optional[Cursor]
	Limit       int
}
type Page struct {
	Items []Record                `json:"items"`
	Next  shared.Optional[Cursor] `json:"next,omitempty"`
}
type Repository interface {
	Insert(context.Context, Record) (Record, bool, error)
	List(context.Context, Query) ([]Record, bool, error)
}

// Correlator implementations must return bounded, time-qualified source evidence.
type Correlator interface {
	AircraftCandidates(context.Context, []aircraft.IdentifierHint, shared.Optional[shared.ObservationTime], int) ([]aircraft.Aircraft, error)
	FlightCandidates(context.Context, shared.AircraftID, shared.Optional[shared.Callsign], shared.ObservationTime, int) ([]flight.Flight, error)
}
type IngestRequest struct {
	Message      communications.AircraftMessage
	WatchRuleIDs []shared.WatchRuleID
	Policy       StoragePolicy
}
type IngestResult struct {
	Record  Record `json:"record"`
	Created bool   `json:"created"`
}
type Service struct {
	repo       Repository
	correlator Correlator
	now        func() time.Time
}

func NewService(repo Repository, correlator Correlator) *Service {
	return &Service{repo: repo, correlator: correlator, now: func() time.Time { return time.Now().UTC() }}
}

func (s *Service) Ingest(ctx context.Context, req IngestRequest) (IngestResult, error) {
	if !req.Policy.AllowMetadata {
		return IngestResult{}, errors.New("message metadata storage is not permitted")
	}
	m := req.Message
	if m.ID == "" {
		m.ID = "pending-message"
	}
	if m.CollectedAt.IsZero() {
		m.CollectedAt = s.now()
	}
	validated, err := communications.NewAircraftMessage(m)
	if err != nil {
		return IngestResult{}, err
	}
	m = validated
	watchIDs, err := normalizeWatchRules(req.WatchRuleIDs)
	if err != nil {
		return IngestResult{}, err
	}
	if !req.Policy.AllowOriginalText && m.OriginalText != "" {
		m.OriginalText = ""
		m.ContentStatus = communications.ContentUnavailable
	}
	if !req.Policy.AllowRFReception {
		m.Reception = shared.None[communications.RFReception]()
	}
	// Revalidate the policy-filtered domain object before deriving identity.
	m, err = communications.NewAircraftMessage(m)
	if err != nil {
		return IngestResult{}, err
	}
	identity, err := m.Identity()
	if err != nil {
		return IngestResult{}, err
	}
	// Preserve the original content digest even when storage policy redacts it.
	digestInput := req.Message
	digestInput.ID = "pending-message"
	if digestInput.CollectedAt.IsZero() {
		digestInput.CollectedAt = m.CollectedAt
	}
	digest, err := sourceDigest(digestInput)
	if err != nil {
		return IngestResult{}, err
	}
	if identity.Method == "conservative_fingerprint" {
		identity.Key = digest
	}
	localID, err := shared.NewMessageID("msg-" + digest[:32])
	if err != nil {
		return IngestResult{}, err
	}
	m.ID = localID
	association := s.correlate(ctx, m)
	sortAt := m.CollectedAt
	if m.ObservedAt.Valid {
		sortAt = m.ObservedAt.Value.Time
	}
	record := Record{Identity: identity, PayloadDigest: digest, Message: m, Association: association, WatchRuleIDs: watchIDs, SortAt: sortAt.UTC(), CreatedAt: s.now().UTC()}
	stored, created, err := s.repo.Insert(ctx, record)
	if err != nil {
		return IngestResult{}, err
	}
	return IngestResult{Record: stored, Created: created}, nil
}

func sourceDigest(m communications.AircraftMessage) (string, error) {
	validated, err := communications.NewAircraftMessage(m)
	if err != nil {
		return "", err
	}
	validated.ID = ""
	validated.CollectedAt = time.Time{}
	encoded, err := json.Marshal(validated)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:]), nil
}
func normalizeWatchRules(ids []shared.WatchRuleID) ([]shared.WatchRuleID, error) {
	if len(ids) == 0 || len(ids) > MaxWatchRules {
		return nil, errors.New("one to 100 authorized watch rules are required")
	}
	set := map[shared.WatchRuleID]bool{}
	for _, id := range ids {
		v, e := shared.NewWatchRuleID(string(id))
		if e != nil {
			return nil, e
		}
		set[v] = true
	}
	out := make([]shared.WatchRuleID, 0, len(set))
	for id := range set {
		out = append(out, id)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out, nil
}

func (s *Service) correlate(ctx context.Context, m communications.AircraftMessage) communications.Association {
	evidence := []communications.AssociationEvidence{}
	if s.correlator == nil {
		return unmatched(m, "correlation_lookup_unavailable", evidence)
	}
	ids := []aircraft.IdentifierHint{}
	if m.Hints.ICAO24.Valid {
		ids = append(ids, aircraft.IdentifierHint{Kind: aircraft.IdentifierICAO24, Value: string(m.Hints.ICAO24.Value)})
	}
	if m.Hints.Registration.Valid {
		ids = append(ids, aircraft.IdentifierHint{Kind: aircraft.IdentifierRegistration, Value: string(m.Hints.Registration.Value)})
	}
	fleet, err := s.correlator.AircraftCandidates(ctx, ids, m.ObservedAt, MaxCorrelationCandidates)
	if err != nil {
		return unmatched(m, "aircraft_lookup_failed", evidence)
	}
	if len(fleet) > MaxCorrelationCandidates {
		return unmatched(m, "aircraft_lookup_candidate_limit_exceeded", evidence)
	}
	resolution := aircraft.ResolveAircraft(fleet, aircraft.ResolveInput{Identifiers: ids, Callsign: m.Hints.Callsign, ObservedAt: m.ObservedAt})
	for _, e := range resolution.Evidence {
		evidence = append(evidence, communications.AssociationEvidence{Kind: string(e.Kind), Value: e.Value, Source: e.Source, AircraftID: shared.Some(e.AircraftID), Reason: e.Reason})
	}
	if resolution.Status == aircraft.ResolutionAmbiguous || resolution.Status == aircraft.ResolutionConflicted {
		out := communications.AssociationAmbiguous
		if resolution.Status == aircraft.ResolutionConflicted {
			out = communications.AssociationConflicted
		}
		a, _ := communications.NewAssociation(communications.Association{Outcome: out, Candidates: resolution.Candidates, Evidence: evidence})
		return a
	}
	if resolution.Status != aircraft.ResolutionMatched || !resolution.AircraftID.Valid {
		return unmatched(m, resolution.Reason, evidence)
	}
	assoc := communications.Association{Outcome: communications.AssociationMatched, AircraftID: resolution.AircraftID, Evidence: evidence}
	if m.ObservedAt.Valid && m.Hints.Callsign.Valid {
		flights, err := s.correlator.FlightCandidates(ctx, resolution.AircraftID.Value, m.Hints.Callsign, m.ObservedAt.Value, MaxCorrelationCandidates)
		if err == nil {
			if len(flights) > MaxCorrelationCandidates {
				assoc.Evidence = append(assoc.Evidence, communications.AssociationEvidence{Kind: "flight", Value: string(m.Hints.Callsign.Value), Source: m.Source, AircraftID: resolution.AircraftID, Reason: "flight_lookup_candidate_limit_exceeded"})
				validated, _ := communications.NewAssociation(assoc)
				return validated
			}
			matches := []shared.FlightID{}
			lo, hi := m.ObservedAt.Value.Bounds()
			for _, f := range flights {
				if !f.AircraftID.Valid || f.AircraftID.Value != resolution.AircraftID.Value {
					continue
				}
				if m.Hints.Callsign.Valid && (!f.Callsign.Valid || !strings.EqualFold(strings.TrimSpace(string(f.Callsign.Value)), strings.TrimSpace(string(m.Hints.Callsign.Value)))) {
					continue
				}
				if !f.StartedAt.Valid || lo.Before(f.StartedAt.Value.At.Time) {
					continue
				}
				if f.EndedAt.Valid && hi.After(f.EndedAt.Value.At.Time) {
					continue
				}
				matches = append(matches, f.ID)
			}
			if len(matches) == 1 {
				assoc.FlightID = shared.Some(matches[0])
				assoc.Evidence = append(assoc.Evidence, communications.AssociationEvidence{Kind: "flight", Value: string(matches[0]), Source: m.Source, FlightID: shared.Some(matches[0]), AircraftID: resolution.AircraftID, Reason: "aircraft_callsign_and_observation_time_agree"})
			} else if len(matches) > 1 {
				assoc.Evidence = append(assoc.Evidence, communications.AssociationEvidence{Kind: "flight", Value: fmt.Sprint(matches), Source: m.Source, AircraftID: resolution.AircraftID, Reason: "multiple_flights_qualify_no_flight_selected"})
			}
		}
	}
	validated, _ := communications.NewAssociation(assoc)
	return validated
}
func unmatched(m communications.AircraftMessage, reason string, e []communications.AssociationEvidence) communications.Association {
	if reason == "" {
		reason = "no_qualifying_aircraft_identity"
	}
	e = append(e, communications.AssociationEvidence{Kind: "message", Value: string(m.ID), Source: m.Source, Reason: reason})
	a, _ := communications.NewAssociation(communications.Association{Outcome: communications.AssociationUnmatched, Evidence: e})
	return a
}

func (s *Service) History(ctx context.Context, q Query) (Page, error) {
	count := 0
	if q.AircraftID.Valid {
		count++
	}
	if q.FlightID.Valid {
		count++
	}
	if q.WatchRuleID.Valid {
		count++
	}
	if count == 0 {
		return Page{}, ErrInvalidQuery
	}
	if q.Limit == 0 {
		q.Limit = DefaultPageSize
	}
	if q.Limit < 1 || q.Limit > MaxPageSize {
		return Page{}, ErrInvalidQuery
	}
	if q.AircraftID.Valid {
		if _, e := shared.NewAircraftID(string(q.AircraftID.Value)); e != nil {
			return Page{}, e
		}
	}
	if q.FlightID.Valid {
		if _, e := shared.NewFlightID(string(q.FlightID.Value)); e != nil {
			return Page{}, e
		}
	}
	if q.WatchRuleID.Valid {
		if _, e := shared.NewWatchRuleID(string(q.WatchRuleID.Value)); e != nil {
			return Page{}, e
		}
	}
	if q.After.Valid {
		if q.After.Value.SortAt.IsZero() || q.After.Value.ID == "" {
			return Page{}, ErrInvalidQuery
		}
		if _, e := shared.NewMessageID(q.After.Value.ID); e != nil {
			return Page{}, e
		}
	}
	items, more, err := s.repo.List(ctx, q)
	if err != nil {
		return Page{}, err
	}
	page := Page{Items: items}
	if more && len(items) > 0 {
		last := items[len(items)-1]
		page.Next = shared.Some(Cursor{SortAt: last.SortAt, ID: string(last.Message.ID)})
	}
	return page, nil
}
