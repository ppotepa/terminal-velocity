package sourcecontrol

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/watch"
	"github.com/ppotepa/terminal-velocity/backend/internal/ports/sources"
)

type healthProvider struct {
	items []Health
	err   error
}

func (p healthProvider) ListSourceHealth(context.Context) ([]Health, error) { return p.items, p.err }
func TestListSourcesReturnsConfiguredHealthAndExplicitUnconfiguredOrBlockedStates(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	handler := NewHandler(healthProvider{items: []Health{{ID: "fixture-adsb", Status: "synthetic", LastSuccessAt: &now, Freshness: "fresh", Budget: &Budget{RemainingRequests: 5, ResetsAt: now.Add(time.Hour)}, Enabled: true}, {ID: "airframes-api", Status: "not_configured", Freshness: "unknown", Enabled: false}, {ID: "opensky", Status: "blocked", Freshness: "unknown", Enabled: false}}})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/sources", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body)
	}
	body := response.Body.String()
	for _, expected := range []string{`"id":"fixture-adsb"`, `"status":"synthetic"`, `"remainingRequests":5`, `"id":"airframes-api"`, `"status":"not_configured"`, `"id":"opensky"`, `"status":"blocked"`, `"enabled":false`} {
		if !strings.Contains(body, expected) {
			t.Fatalf("response missing %s: %s", expected, body)
		}
	}
}
func TestListSourcesUnconfiguredIsEmptyAndFailuresAreStructured(t *testing.T) {
	empty := httptest.NewRecorder()
	NewHandler(nil).ServeHTTP(empty, httptest.NewRequest(http.MethodGet, "/sources", nil))
	if empty.Code != http.StatusOK || strings.TrimSpace(empty.Body.String()) != "[]" {
		t.Fatalf("empty status=%d body=%s", empty.Code, empty.Body)
	}
	failed := httptest.NewRecorder()
	NewHandler(healthProvider{err: errors.New("private adapter detail")}).ServeHTTP(failed, httptest.NewRequest(http.MethodGet, "/sources", nil))
	if failed.Code != http.StatusServiceUnavailable || strings.Contains(failed.Body.String(), "private adapter detail") || !strings.Contains(failed.Body.String(), "dependency_unavailable") {
		t.Fatalf("failure status=%d body=%s", failed.Code, failed.Body)
	}
	invalid := httptest.NewRecorder()
	NewHandler(healthProvider{items: []Health{{ID: "airframes-api", Status: "connected", Freshness: "fresh", Enabled: true}}}).ServeHTTP(invalid, httptest.NewRequest(http.MethodGet, "/sources", nil))
	if invalid.Code != http.StatusServiceUnavailable {
		t.Fatalf("invalid health status=%d body=%s", invalid.Code, invalid.Body)
	}
}

func TestPlannerValidatorExplainsUnsupportedAndOverwideQueries(t *testing.T) {
	validator := PlannerValidator{Capabilities: []sources.Capabilities{{ID: "fixture", Lookups: []sources.LookupKind{sources.LookupICAO24}, RequestsPerWindow: 100, QuotaWindow: time.Hour, RequestTimeout: time.Second, MaxResultsPerRequest: 100}}}
	unsupported := watch.WatchRule{ID: "rule-unsupported", Name: "Protocol only", Status: watch.StatusActive, Scope: watch.ScopeTargeted, Groups: []watch.CriteriaGroup{{Mode: watch.GroupAny, Criteria: []watch.Criterion{{Kind: watch.CriterionProtocol, Value: "acars"}}}}, Collection: watch.CollectionPreferences{Positions: true}}
	issues, err := validator.Validate(context.Background(), unsupported)
	if err != nil || len(issues) == 0 || issues[0].Code != "no_capable_source" {
		t.Fatalf("issues=%+v err=%v", issues, err)
	}
	wide := watch.WatchRule{ID: "rule-wide", Name: "Wide list", Status: watch.StatusActive, Scope: watch.ScopeTargeted, Groups: []watch.CriteriaGroup{{Mode: watch.GroupAny}}, Collection: watch.CollectionPreferences{Positions: true}}
	for i := 0; i < 65; i++ {
		wide.Groups[0].Criteria = append(wide.Groups[0].Criteria, watch.Criterion{Kind: watch.CriterionICAO24, Value: fmt.Sprintf("%06X", i+1)})
	}
	issues, err = validator.Validate(context.Background(), wide)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, issue := range issues {
		if issue.Code == "query_limit_exceeded" {
			found = true
		}
	}
	if !found {
		t.Fatalf("wide query not rejected with explanation: %+v", issues)
	}
}
