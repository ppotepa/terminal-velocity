// Package aircraft models stable aircraft identity and time-bounded identifier
// assertions. Callsigns are deliberately excluded from permanent identity.
package aircraft

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

type IdentifierKind string

const (
	IdentifierICAO24       IdentifierKind = "icao24"
	IdentifierRegistration IdentifierKind = "registration"
)

type IdentifierAssertion struct {
	Kind       IdentifierKind             `json:"kind"`
	Value      string                     `json:"value"`
	ValidFrom  time.Time                  `json:"valid_from"`
	ValidUntil shared.Optional[time.Time] `json:"valid_until"`
	Evidence   shared.Evidence            `json:"evidence"`
}

// AliasConflict records an identifier asserted for distinct aircraft over an
// overlapping validity interval. It is returned by resolution, never hidden.
type AliasConflict struct {
	Kind      IdentifierKind      `json:"kind"`
	Value     string              `json:"value"`
	Aircrafts []shared.AircraftID `json:"aircrafts"`
	At        time.Time           `json:"at"`
}

type Aircraft struct {
	ID         shared.AircraftID     `json:"id"`
	Assertions []IdentifierAssertion `json:"assertions"`
}

func NewAircraft(id shared.AircraftID, assertions []IdentifierAssertion) (Aircraft, error) {
	if _, err := shared.NewAircraftID(string(id)); err != nil {
		return Aircraft{}, fmt.Errorf("aircraft id: %w", err)
	}
	copyAssertions := append([]IdentifierAssertion(nil), assertions...)
	for i := range copyAssertions {
		a, err := normalizeAssertion(copyAssertions[i])
		if err != nil {
			return Aircraft{}, fmt.Errorf("assertion %d: %w", i, err)
		}
		copyAssertions[i] = a
	}
	sort.Slice(copyAssertions, func(i, j int) bool {
		if copyAssertions[i].ValidFrom.Equal(copyAssertions[j].ValidFrom) {
			return copyAssertions[i].Kind < copyAssertions[j].Kind
		}
		return copyAssertions[i].ValidFrom.Before(copyAssertions[j].ValidFrom)
	})
	return Aircraft{ID: id, Assertions: copyAssertions}, nil
}

func normalizeAssertion(a IdentifierAssertion) (IdentifierAssertion, error) {
	if a.ValidFrom.IsZero() {
		return a, shared.NewDomainError(shared.ErrInvalidInput, "identifier validity start is required")
	}
	a.ValidFrom = a.ValidFrom.UTC()
	if a.ValidUntil.Valid {
		if a.ValidUntil.Value.IsZero() || !a.ValidUntil.Value.After(a.ValidFrom) {
			return a, shared.NewDomainError(shared.ErrInvalidInput, "identifier validity end must be after start")
		}
		a.ValidUntil.Value = a.ValidUntil.Value.UTC()
	}
	if err := a.Evidence.Validate(); err != nil {
		return a, fmt.Errorf("identifier evidence: %w", err)
	}
	switch a.Kind {
	case IdentifierICAO24:
		v, err := shared.NewICAO24(a.Value)
		if err != nil {
			return a, err
		}
		a.Value = string(v)
	case IdentifierRegistration:
		v, err := shared.NewRegistration(a.Value)
		if err != nil {
			return a, err
		}
		a.Value = string(v)
	default:
		return a, shared.NewDomainError(shared.ErrInvalidInput, "unsupported permanent aircraft identifier kind")
	}
	return a, nil
}

type ResolutionStatus string

const (
	ResolutionMatched    ResolutionStatus = "matched"
	ResolutionAmbiguous  ResolutionStatus = "ambiguous"
	ResolutionUnmatched  ResolutionStatus = "unmatched"
	ResolutionConflicted ResolutionStatus = "conflicted"
	ResolutionUnknown    ResolutionStatus = "unknown"
)

type IdentifierHint struct {
	Kind  IdentifierKind
	Value string
}

type ResolveInput struct {
	Identifiers []IdentifierHint
	Callsign    shared.Optional[shared.Callsign]
	ObservedAt  shared.Optional[shared.ObservationTime]
}

type ResolutionEvidence struct {
	AircraftID shared.AircraftID `json:"aircraft_id"`
	Kind       IdentifierKind    `json:"kind"`
	Value      string            `json:"value"`
	Source     shared.SourceID   `json:"source"`
	Outcome    string            `json:"outcome"`
	Reason     string            `json:"reason"`
}

type Resolution struct {
	Status     ResolutionStatus                   `json:"status"`
	AircraftID shared.Optional[shared.AircraftID] `json:"aircraft_id"`
	Candidates []shared.AircraftID                `json:"candidates,omitempty"`
	Evidence   []ResolutionEvidence               `json:"evidence"`
	Conflict   *AliasConflict                     `json:"conflict,omitempty"`
	Reason     string                             `json:"reason"`
}

// ResolveAircraft matches permanent identifiers at the supplied observation
// time. Callsign is retained as contextual evidence only and never chooses an
// aircraft. Input identifiers that disagree yield CONFLICTED.
func ResolveAircraft(fleet []Aircraft, input ResolveInput) Resolution {
	if len(input.Identifiers) == 0 {
		if input.Callsign.Valid {
			return Resolution{Status: ResolutionUnknown, Reason: "callsign_is_flight_context_not_aircraft_identity"}
		}
		return Resolution{Status: ResolutionUnknown, Reason: "no_permanent_identifier_supplied"}
	}
	if !input.ObservedAt.Valid || input.ObservedAt.Value.Time.IsZero() {
		return Resolution{Status: ResolutionUnknown, Reason: "observation_time_required_for_historical_resolution"}
	}
	lo, hi := input.ObservedAt.Value.Bounds()
	allCandidates := map[shared.AircraftID]bool{}
	perHint := make([]map[shared.AircraftID]bool, len(input.Identifiers))
	evidence := make([]ResolutionEvidence, 0)
	unknownTime := false
	for i, hint := range input.Identifiers {
		perHint[i] = map[shared.AircraftID]bool{}
		value, err := normalizeHint(hint)
		if err != nil {
			return Resolution{Status: ResolutionUnknown, Reason: "invalid_identifier_hint: " + err.Error()}
		}
		for _, aircraft := range fleet {
			for _, assertion := range aircraft.Assertions {
				if assertion.Kind != hint.Kind || assertion.Value != value {
					continue
				}
				if !containsTime(assertion, lo, hi) {
					if overlapsTime(assertion, lo, hi) {
						unknownTime = true
					}
					continue
				}
				perHint[i][aircraft.ID] = true
				allCandidates[aircraft.ID] = true
				evidence = append(evidence, ResolutionEvidence{AircraftID: aircraft.ID, Kind: hint.Kind, Value: value, Source: assertion.Evidence.Source, Outcome: "candidate", Reason: "identifier_assertion_valid_at_observation_time"})
			}
		}
	}
	if unknownTime && len(allCandidates) == 0 {
		return Resolution{Status: ResolutionUnknown, Evidence: evidence, Reason: "observation_uncertainty_overlaps_identifier_validity_boundary"}
	}
	if len(allCandidates) == 0 {
		return Resolution{Status: ResolutionUnmatched, Evidence: evidence, Reason: "no_identifier_assertion_valid_at_observation_time"}
	}
	if len(input.Identifiers) > 1 {
		var common map[shared.AircraftID]bool
		unresolvedHint := false
		for _, candidates := range perHint {
			if len(candidates) == 0 {
				unresolvedHint = true
				continue
			}
			if common == nil {
				common = cloneSet(candidates)
				continue
			}
			for id := range common {
				if !candidates[id] {
					delete(common, id)
				}
			}
		}
		if common != nil && len(common) == 0 {
			ids := sortedIDs(allCandidates)
			return Resolution{Status: ResolutionConflicted, Candidates: ids, Evidence: markConflicted(evidence), Reason: "permanent_identifiers_resolve_to_different_aircraft"}
		}
		if unresolvedHint {
			return Resolution{Status: ResolutionUnknown, Candidates: sortedIDs(allCandidates), Evidence: evidence, Reason: "one_or_more_permanent_identifiers_have_no_qualifying_assertion"}
		}
	}
	ids := sortedIDs(allCandidates)
	if len(ids) > 1 {
		conflict := &AliasConflict{Kind: input.Identifiers[0].Kind, Aircrafts: ids, At: input.ObservedAt.Value.Time.UTC()}
		v, _ := normalizeHint(input.Identifiers[0])
		conflict.Value = v
		return Resolution{Status: ResolutionAmbiguous, Candidates: ids, Evidence: evidence, Conflict: conflict, Reason: "identifier_is_asserted_for_multiple_aircraft_at_observation_time"}
	}
	if unknownTime {
		return Resolution{Status: ResolutionUnknown, Candidates: ids, Evidence: evidence, Reason: "additional_identifier_validity_uncertain"}
	}
	return Resolution{Status: ResolutionMatched, AircraftID: shared.Some(ids[0]), Candidates: ids, Evidence: evidence, Reason: "permanent_identifier_evidence_agrees"}
}

func normalizeHint(h IdentifierHint) (string, error) {
	switch h.Kind {
	case IdentifierICAO24:
		v, err := shared.NewICAO24(h.Value)
		return string(v), err
	case IdentifierRegistration:
		v, err := shared.NewRegistration(h.Value)
		return string(v), err
	default:
		return "", shared.NewDomainError(shared.ErrInvalidInput, "unsupported permanent aircraft identifier kind")
	}
}

func containsTime(a IdentifierAssertion, lo, hi time.Time) bool {
	if lo.Before(a.ValidFrom) {
		return false
	}
	return !a.ValidUntil.Valid || hi.Before(a.ValidUntil.Value)
}

func overlapsTime(a IdentifierAssertion, lo, hi time.Time) bool {
	if hi.Before(a.ValidFrom) {
		return false
	}
	return !a.ValidUntil.Valid || lo.Before(a.ValidUntil.Value)
}

func cloneSet(in map[shared.AircraftID]bool) map[shared.AircraftID]bool {
	out := make(map[shared.AircraftID]bool, len(in))
	for id := range in {
		out[id] = true
	}
	return out
}

func sortedIDs(set map[shared.AircraftID]bool) []shared.AircraftID {
	ids := make([]shared.AircraftID, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids
}

func markConflicted(evidence []ResolutionEvidence) []ResolutionEvidence {
	result := append([]ResolutionEvidence(nil), evidence...)
	for i := range result {
		result[i].Outcome = "conflicted"
		result[i].Reason = "identifier_evidence_disagrees"
	}
	return result
}

// CallsignValue returns a normalized flight-context value without implying an
// aircraft identity.
func CallsignValue(value string) (shared.Callsign, error) {
	return shared.NewCallsign(strings.ToUpper(strings.TrimSpace(value)))
}
