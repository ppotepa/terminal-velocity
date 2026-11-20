// Package watch contains the pure WatchRule aggregate and candidate matcher.
// It never performs acquisition; adapters plan bounded source queries elsewhere.
package watch

import (
	"fmt"
	"strings"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

type Status string

const (
	StatusActive  Status = "active"
	StatusPaused  Status = "paused"
	StatusDeleted Status = "deleted"
)

type Scope string

const (
	ScopeTargeted      Scope = "targeted"
	ScopeAreaDiscovery Scope = "area_discovery"
)

type GroupMode string

const (
	GroupAny GroupMode = "any"
	GroupAll GroupMode = "all"
)

type CriterionKind string

const (
	CriterionCallsign     CriterionKind = "callsign"
	CriterionICAO24       CriterionKind = "icao24"
	CriterionRegistration CriterionKind = "registration"
	CriterionOperator     CriterionKind = "operator"
	CriterionOrigin       CriterionKind = "origin"
	CriterionDestination  CriterionKind = "destination"
	CriterionArea         CriterionKind = "area"
	CriterionProtocol     CriterionKind = "protocol"
)

type Criterion struct {
	Kind  CriterionKind `json:"kind"`
	Value string        `json:"value"`
}

type CriteriaGroup struct {
	Mode     GroupMode   `json:"mode"`
	Criteria []Criterion `json:"criteria"`
}

type CollectionPreferences struct {
	Positions  bool     `json:"positions"`
	Messages   bool     `json:"messages"`
	DecoderIDs []string `json:"decoder_ids,omitempty"`
}

type Window struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}

type DiscoveryBounds struct {
	AreaID        string `json:"area_id"`
	MaxCandidates int    `json:"max_candidates"`
}

type WatchRule struct {
	ID         shared.WatchRuleID    `json:"id"`
	Name       string                `json:"name"`
	Status     Status                `json:"status"`
	Scope      Scope                 `json:"scope"`
	Groups     []CriteriaGroup       `json:"groups"`
	Window     *Window               `json:"window,omitempty"`
	Discovery  *DiscoveryBounds      `json:"discovery,omitempty"`
	Collection CollectionPreferences `json:"collection"`
}

// NewWatchRule validates an aggregate without performing any I/O.
func NewWatchRule(rule WatchRule) (WatchRule, error) {
	if _, err := shared.NewWatchRuleID(string(rule.ID)); err != nil {
		return WatchRule{}, fmt.Errorf("watch rule id: %w", err)
	}
	rule.Name = strings.TrimSpace(rule.Name)
	if rule.Name == "" || len(rule.Name) > 120 {
		return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "watch rule name must contain 1-120 characters")
	}
	if rule.Status == "" {
		rule.Status = StatusActive
	}
	if rule.Status != StatusActive && rule.Status != StatusPaused && rule.Status != StatusDeleted {
		return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "unsupported watch rule status")
	}
	if rule.Scope == "" {
		rule.Scope = ScopeTargeted
	}
	if rule.Scope != ScopeTargeted && rule.Scope != ScopeAreaDiscovery {
		return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "unsupported watch rule scope")
	}
	if len(rule.Groups) == 0 && rule.Scope == ScopeTargeted {
		return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "targeted watch rule requires at least one criterion")
	}
	for gi := range rule.Groups {
		g := &rule.Groups[gi]
		if g.Mode != GroupAny && g.Mode != GroupAll {
			return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "criteria group mode must be any or all")
		}
		if len(g.Criteria) == 0 {
			return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "criteria groups cannot be empty")
		}
		for ci := range g.Criteria {
			c := &g.Criteria[ci]
			v, err := normalizeCriterion(*c)
			if err != nil {
				return WatchRule{}, fmt.Errorf("group %d criterion %d: %w", gi, ci, err)
			}
			c.Value = v
		}
	}
	if rule.Window != nil {
		if rule.Window.Start.IsZero() || rule.Window.End.IsZero() || !rule.Window.End.After(rule.Window.Start) {
			return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "window end must be after a non-zero start")
		}
		rule.Window.Start = rule.Window.Start.UTC()
		rule.Window.End = rule.Window.End.UTC()
		if rule.Window.End.Sub(rule.Window.Start) > 366*24*time.Hour {
			return WatchRule{}, shared.NewDomainError(shared.ErrOutOfRange, "watch window cannot exceed 366 days")
		}
	}
	if rule.Scope == ScopeAreaDiscovery {
		if rule.Discovery == nil || strings.TrimSpace(rule.Discovery.AreaID) == "" {
			return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "area discovery requires a bounded area")
		}
		if rule.Discovery.MaxCandidates < 1 || rule.Discovery.MaxCandidates > 1000 {
			return WatchRule{}, shared.NewDomainError(shared.ErrOutOfRange, "area discovery candidate limit must be between 1 and 1000")
		}
	} else if rule.Discovery != nil {
		return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "targeted monitoring cannot include area discovery bounds")
	}
	if !rule.Collection.Positions && !rule.Collection.Messages {
		return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "watch rule must collect positions or messages")
	}
	if len(rule.Collection.DecoderIDs) > 0 && !rule.Collection.Messages {
		return WatchRule{}, shared.NewDomainError(shared.ErrInvalidInput, "decoder selection requires message collection")
	}
	if len(rule.Collection.DecoderIDs) > 32 {
		return WatchRule{}, shared.NewDomainError(shared.ErrOutOfRange, "at most 32 decoders may be selected")
	}
	seen := map[string]bool{}
	for i, id := range rule.Collection.DecoderIDs {
		if _, err := shared.NewSourceID(id); err != nil {
			return WatchRule{}, fmt.Errorf("decoder id %d: %w", i, err)
		}
		if seen[id] {
			return WatchRule{}, shared.NewDomainError(shared.ErrConflict, "decoder IDs must be unique")
		}
		seen[id] = true
	}
	return rule, nil
}

func normalizeCriterion(c Criterion) (string, error) {
	v := strings.ToUpper(strings.TrimSpace(c.Value))
	if v == "" {
		return "", shared.NewDomainError(shared.ErrInvalidInput, "criterion value is required")
	}
	switch c.Kind {
	case CriterionCallsign:
		if strings.HasSuffix(v, "*") {
			prefix := strings.TrimSpace(strings.TrimSuffix(v, "*"))
			if prefix == "" || strings.ContainsAny(prefix, "*?/") {
				return "", shared.NewDomainError(shared.ErrInvalidInput, "callsign wildcard is allowed only as one non-empty trailing *")
			}
			if _, err := shared.NewCallsign(prefix); err != nil {
				return "", err
			}
			return prefix + "*", nil
		}
		if _, err := shared.NewCallsign(v); err != nil {
			return "", err
		}
		return strings.TrimRight(v, " "), nil
	case CriterionICAO24:
		id, err := shared.NewICAO24(v)
		return string(id), err
	case CriterionRegistration:
		id, err := shared.NewRegistration(v)
		return string(id), err
	case CriterionOperator, CriterionOrigin, CriterionDestination, CriterionArea, CriterionProtocol:
		if len(v) > 64 || strings.ContainsAny(v, "*/?\\") {
			return "", shared.NewDomainError(shared.ErrInvalidInput, "criterion value is too long or contains wildcard characters")
		}
		return v, nil
	default:
		return "", shared.NewDomainError(shared.ErrInvalidInput, "unknown criterion kind")
	}
}

type Candidate struct {
	Callsign     shared.Optional[shared.Callsign]
	ICAO24       shared.Optional[shared.ICAO24]
	Registration shared.Optional[shared.Registration]
	Operator     shared.Optional[string]
	Origin       shared.Optional[string]
	Destination  shared.Optional[string]
	Areas        []string
	Protocols    []string
	ObservedAt   shared.Optional[shared.ObservationTime]
}

type MatchStatus string

const (
	Match   MatchStatus = "match"
	NoMatch MatchStatus = "no_match"
	Unknown MatchStatus = "unknown"
)

type CriterionEvidence struct {
	Criterion Criterion   `json:"criterion"`
	Outcome   MatchStatus `json:"outcome"`
	Reason    string      `json:"reason"`
}

type MatchResult struct {
	Status   MatchStatus         `json:"status"`
	Evidence []CriterionEvidence `json:"evidence"`
}

// MatchWatchCriteria evaluates only supplied candidate data. Missing candidate
// fields produce UNKNOWN and never trigger a source fetch.
func MatchWatchCriteria(rule WatchRule, candidate Candidate) MatchResult {
	validated, err := NewWatchRule(rule)
	if err != nil {
		return MatchResult{Status: Unknown, Evidence: []CriterionEvidence{{Outcome: Unknown, Reason: "invalid_watch_rule: " + err.Error()}}}
	}
	if validated.Status != StatusActive {
		return MatchResult{Status: NoMatch, Evidence: []CriterionEvidence{{Outcome: NoMatch, Reason: "watch_rule_not_active"}}}
	}
	if validated.Window != nil {
		if !candidate.ObservedAt.Valid || candidate.ObservedAt.Value.Time.IsZero() {
			return MatchResult{Status: Unknown, Evidence: []CriterionEvidence{{Outcome: Unknown, Reason: "observation_time_missing_for_bounded_window"}}}
		}
		lo, hi := candidate.ObservedAt.Value.Bounds()
		if hi.Before(validated.Window.Start) || lo.After(validated.Window.End) {
			return MatchResult{Status: NoMatch, Evidence: []CriterionEvidence{{Outcome: NoMatch, Reason: "observation_outside_window"}}}
		}
		if lo.Before(validated.Window.Start) || hi.After(validated.Window.End) {
			return MatchResult{Status: Unknown, Evidence: []CriterionEvidence{{Outcome: Unknown, Reason: "observation_uncertainty_overlaps_window_boundary"}}}
		}
	}
	result := MatchResult{Status: Match}
	if validated.Scope == ScopeAreaDiscovery {
		e := evaluate(Criterion{Kind: CriterionArea, Value: strings.ToUpper(validated.Discovery.AreaID)}, candidate)
		result.Evidence = append(result.Evidence, e)
		if e.Outcome != Match {
			return MatchResult{Status: e.Outcome, Evidence: result.Evidence}
		}
	}
	for _, group := range validated.Groups {
		matches, nonMatches, unknowns := 0, 0, 0
		for _, criterion := range group.Criteria {
			e := evaluate(criterion, candidate)
			result.Evidence = append(result.Evidence, e)
			switch e.Outcome {
			case Match:
				matches++
			case NoMatch:
				nonMatches++
			case Unknown:
				unknowns++
			}
		}
		groupMatch := group.Mode == GroupAny && matches > 0 || group.Mode == GroupAll && nonMatches == 0 && unknowns == 0
		groupFail := group.Mode == GroupAny && matches == 0 && nonMatches > 0 && unknowns == 0 || group.Mode == GroupAll && nonMatches > 0
		if groupFail {
			result.Status = NoMatch
		} else if !groupMatch && result.Status != NoMatch {
			result.Status = Unknown
		}
	}
	return result
}

func evaluate(c Criterion, candidate Candidate) CriterionEvidence {
	e := CriterionEvidence{Criterion: c}
	known := true
	var actual string
	switch c.Kind {
	case CriterionCallsign:
		if candidate.Callsign.Valid {
			actual = string(candidate.Callsign.Value)
		} else {
			known = false
		}
	case CriterionICAO24:
		if candidate.ICAO24.Valid {
			actual = string(candidate.ICAO24.Value)
		} else {
			known = false
		}
	case CriterionRegistration:
		if candidate.Registration.Valid {
			actual = string(candidate.Registration.Value)
		} else {
			known = false
		}
	case CriterionOperator:
		if candidate.Operator.Valid {
			actual = candidate.Operator.Value
		} else {
			known = false
		}
	case CriterionOrigin:
		if candidate.Origin.Valid {
			actual = candidate.Origin.Value
		} else {
			known = false
		}
	case CriterionDestination:
		if candidate.Destination.Valid {
			actual = candidate.Destination.Value
		} else {
			known = false
		}
	case CriterionArea:
		actual, known = findFold(candidate.Areas, c.Value)
	case CriterionProtocol:
		actual, known = findFold(candidate.Protocols, c.Value)
	}
	if !known {
		e.Outcome = Unknown
		e.Reason = "candidate_value_unobserved"
		return e
	}
	matched := strings.EqualFold(actual, c.Value)
	if c.Kind == CriterionCallsign && strings.HasSuffix(c.Value, "*") {
		matched = strings.HasPrefix(strings.ToUpper(actual), strings.TrimSuffix(c.Value, "*"))
	}
	if matched {
		e.Outcome = Match
		e.Reason = "candidate_value_matches"
	} else {
		e.Outcome = NoMatch
		e.Reason = "candidate_value_differs"
	}
	return e
}

func findFold(values []string, expected string) (string, bool) {
	if len(values) == 0 {
		return "", false
	}
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), expected) {
			return value, true
		}
	}
	return "", true
}
