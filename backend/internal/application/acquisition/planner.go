// Package acquisition plans bounded source requests and schedules injected adapters.
package acquisition

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"

	"github.com/ppotepa/terminal-velocity/backend/internal/application/watchlist"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/watch"
	"github.com/ppotepa/terminal-velocity/backend/internal/ports/sources"
)

const (
	MaxQueriesPerRule = 64
	MaxQueriesPerPlan = 10000
)

type Rejection struct {
	RuleID   shared.WatchRuleID
	SourceID string
	Reason   string
	Message  string
}

type PlanResult struct {
	Requests   []sources.Query
	Rejections []Rejection
}

type target struct {
	lookup sources.LookupKind
	value  string
	areaID string
	prefix bool
	limit  int
}

// QueryPlanner compiles only explicit identifiers or hard-bounded area rules.
type QueryPlanner struct{}

func (QueryPlanner) Plan(rules []watchlist.StoredRule, capabilities []sources.Capabilities) (PlanResult, error) {
	bySource := make(map[string]sources.Capabilities, len(capabilities))
	for _, capability := range capabilities {
		if err := capability.Validate(); err != nil {
			return PlanResult{}, fmt.Errorf("source %q capabilities: %w", capability.ID, err)
		}
		if _, exists := bySource[capability.ID]; exists {
			return PlanResult{}, fmt.Errorf("duplicate source capability ID %q", capability.ID)
		}
		bySource[capability.ID] = capability
	}
	sourceIDs := make([]string, 0, len(bySource))
	for id := range bySource {
		sourceIDs = append(sourceIDs, id)
	}
	sort.Strings(sourceIDs)

	result := PlanResult{Requests: []sources.Query{}, Rejections: []Rejection{}}
	queries := make(map[string]*sources.Query)
	seenRules := make(map[shared.WatchRuleID]struct{}, len(rules))
	for _, stored := range rules {
		rule := stored.Rule
		if rule.Status != watch.StatusActive {
			continue
		}
		if _, exists := seenRules[rule.ID]; exists {
			continue
		}
		seenRules[rule.ID] = struct{}{}
		validated, err := watch.NewWatchRule(rule)
		if err != nil {
			result.Rejections = append(result.Rejections, Rejection{RuleID: rule.ID, Reason: "invalid_rule", Message: err.Error()})
			continue
		}
		plannedForRule := 0
	sourceLoop:
		for _, sourceID := range sourceIDs {
			capability := bySource[sourceID]
			targets := ruleTargets(validated, capability)
			for _, item := range targets {
				if plannedForRule >= MaxQueriesPerRule {
					result.Rejections = append(result.Rejections, Rejection{RuleID: rule.ID, Reason: "query_limit_exceeded", Message: "watch rule exceeds the bounded per-rule query limit"})
					break sourceLoop
				}
				query := makeQuery(validated, capability, item)
				if _, exists := queries[query.Key]; !exists && len(queries) >= MaxQueriesPerPlan {
					result.Rejections = append(result.Rejections, Rejection{RuleID: rule.ID, SourceID: sourceID, Reason: "plan_limit_exceeded", Message: "planned request set reached its bounded cycle limit"})
					break sourceLoop
				}
				mergeQuery(queries, query)
				plannedForRule++
			}
		}
		if plannedForRule == 0 {
			result.Rejections = append(result.Rejections, Rejection{RuleID: rule.ID, Reason: "no_capable_source", Message: "no configured source can perform an explicit bounded lookup for this rule"})
		}
	}

	for _, query := range queries {
		sort.Strings(query.RuleIDs)
		result.Requests = append(result.Requests, *query)
	}
	sort.Slice(result.Requests, func(i, j int) bool {
		if result.Requests[i].SourceID != result.Requests[j].SourceID {
			return result.Requests[i].SourceID < result.Requests[j].SourceID
		}
		return result.Requests[i].Key < result.Requests[j].Key
	})
	result.Requests = applyQuotaCaps(result.Requests, bySource, &result.Rejections)
	sort.Slice(result.Rejections, func(i, j int) bool {
		if result.Rejections[i].RuleID != result.Rejections[j].RuleID {
			return result.Rejections[i].RuleID < result.Rejections[j].RuleID
		}
		if result.Rejections[i].SourceID != result.Rejections[j].SourceID {
			return result.Rejections[i].SourceID < result.Rejections[j].SourceID
		}
		return result.Rejections[i].Reason < result.Rejections[j].Reason
	})
	return result, nil
}

func ruleTargets(rule watch.WatchRule, capability sources.Capabilities) []target {
	if rule.Scope == watch.ScopeAreaDiscovery {
		if !capability.Supports(sources.LookupArea) || rule.Discovery == nil {
			return nil
		}
		limit := rule.Discovery.MaxCandidates
		if limit > capability.MaxCandidatesPerArea {
			limit = capability.MaxCandidatesPerArea
		}
		if limit < 1 {
			return nil
		}
		return []target{{lookup: sources.LookupArea, areaID: strings.ToUpper(strings.TrimSpace(rule.Discovery.AreaID)), limit: limit}}
	}

	lookupByCriterion := map[watch.CriterionKind]sources.LookupKind{
		watch.CriterionICAO24:       sources.LookupICAO24,
		watch.CriterionCallsign:     sources.LookupCallsign,
		watch.CriterionRegistration: sources.LookupRegistration,
	}
	unique := make(map[string]target)
	for _, group := range rule.Groups {
		for _, criterion := range group.Criteria {
			lookup, supported := lookupByCriterion[criterion.Kind]
			if !supported || !capability.Supports(lookup) {
				continue
			}
			prefix := lookup == sources.LookupCallsign && strings.HasSuffix(criterion.Value, "*")
			if prefix && !capability.SupportsCallsignPrefix {
				continue
			}
			value := strings.TrimSpace(criterion.Value)
			if prefix {
				value = strings.TrimSuffix(value, "*")
			}
			item := target{lookup: lookup, value: value, prefix: prefix}
			unique[string(item.lookup)+"\x00"+item.value+fmt.Sprint(item.prefix)] = item
		}
	}
	keys := make([]string, 0, len(unique))
	for key := range unique {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	items := make([]target, 0, len(keys))
	for _, key := range keys {
		items = append(items, unique[key])
	}
	return items
}

func makeQuery(rule watch.WatchRule, capability sources.Capabilities, item target) sources.Query {
	query := sources.Query{
		SourceID: capability.ID, Lookup: item.lookup, Value: item.value, AreaID: item.areaID, Prefix: item.prefix,
		CandidateLimit: capability.MaxResultsPerRequest, PollInterval: capability.MinimumInterval,
		RuleIDs: []string{string(rule.ID)},
	}
	if item.lookup == sources.LookupArea {
		query.CandidateLimit = min(item.limit, capability.MaxCandidatesPerArea)
	}
	query.Key = queryKey(query)
	return query
}

func mergeQuery(queries map[string]*sources.Query, query sources.Query) {
	if existing, found := queries[query.Key]; found {
		existing.RuleIDs = append(existing.RuleIDs, query.RuleIDs...)
		// Shared area requests use the smallest rule limit so coalescing cannot
		// exceed any participating rule's explicit discovery bound.
		if query.CandidateLimit < existing.CandidateLimit {
			existing.CandidateLimit = query.CandidateLimit
		}
		return
	}
	copy := query
	queries[query.Key] = &copy
}

func queryKey(query sources.Query) string {
	identity := strings.Join([]string{query.SourceID, string(query.Lookup), query.Value, query.AreaID, fmt.Sprint(query.Prefix)}, "\x00")
	hash := sha256.Sum256([]byte(identity))
	return "q-" + hex.EncodeToString(hash[:16])
}

func applyQuotaCaps(requests []sources.Query, capabilities map[string]sources.Capabilities, rejections *[]Rejection) []sources.Query {
	counts := make(map[string]int)
	kept := make([]sources.Query, 0, len(requests))
	for _, query := range requests {
		capability := capabilities[query.SourceID]
		if counts[query.SourceID] >= capability.RequestsPerWindow {
			for _, ruleID := range query.RuleIDs {
				*rejections = append(*rejections, Rejection{RuleID: shared.WatchRuleID(ruleID), SourceID: query.SourceID, Reason: "source_quota_exceeded", Message: "request omitted because the source quota cannot support the planned cycle"})
			}
			continue
		}
		counts[query.SourceID]++
		kept = append(kept, query)
	}
	return kept
}
