package positions

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/ports/sources"
)

type fixtureToken string

func (t fixtureToken) AccessToken(context.Context) (string, error) { return string(t), nil }

func stateFixture(t *testing.T) []byte {
	t.Helper()
	body, err := os.ReadFile("fixtures/opensky_states.json")
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func testQuery(kind sources.LookupKind, value string, limit int) sources.Query {
	return sources.Query{SourceID: openSkySourceID, Lookup: kind, Value: value, AreaID: func() string {
		if kind == sources.LookupArea {
			return "DE"
		}
		return ""
	}(), CandidateLimit: limit}
}

func newFixtureSource(t *testing.T, server *httptest.Server, config Config) *OpenSkySource {
	t.Helper()
	config.LicenseConfirmed = true
	config.APIBaseURL = server.URL + "/api"
	config.HTTPClient = server.Client()
	if config.TokenProvider == nil && config.OAuthClientID == "" {
		config.TokenProvider = fixtureToken("synthetic-token")
	}
	source, err := NewOpenSkySource(config)
	if err != nil {
		t.Fatal(err)
	}
	return source
}

func TestFetchTargetsOneAircraftAndNormalizesSyntheticState(t *testing.T) {
	fixture := stateFixture(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/states/all" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.String())
		}
		if len(r.URL.Query()) != 1 || r.URL.Query().Get("icao24") != "a1b2c3" {
			t.Errorf("query was not restricted to the target aircraft: %v", r.URL.Query())
		}
		if r.Header.Get("Authorization") != "Bearer synthetic-token" {
			t.Errorf("bearer token missing")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(fixture)
	}))
	defer server.Close()
	source := newFixtureSource(t, server, Config{})
	result, err := source.Fetch(context.Background(), testQuery(sources.LookupICAO24, "A1B2C3", 10))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Records) != 1 || !result.Records[0].ObservedAt.Equal(time.Unix(1735689598, 0).UTC()) {
		t.Fatalf("unexpected source result: %+v", result)
	}
	var record PositionRecord
	if err := json.Unmarshal(result.Records[0].Payload, &record); err != nil {
		t.Fatal(err)
	}
	position := record.Observation
	if record.ICAO24 != "A1B2C3" || record.Callsign != "UAL52" || record.PositionSource != "adsb" || record.AltitudeKind != "barometric" {
		t.Fatalf("identity/provenance was not normalized: %+v", record)
	}
	if position.Source != openSkySourceID || position.Latitude != 37.7749 || position.Longitude != -122.4194 || !position.AltitudeMeters.Valid || position.AltitudeMeters.Value != 10000 || !position.GroundSpeedMPS.Valid || position.GroundSpeedMPS.Value != 230.5 || !position.HeadingDegrees.Valid || position.HeadingDegrees.Value != 85.2 {
		t.Fatalf("position fields were not normalized: %+v", position)
	}
	if source.Health().Status != "ok" {
		t.Fatalf("source health = %+v", source.Health())
	}
}

func TestDisabledPermissionGateMakesNoRequest(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer server.Close()
	source, err := NewOpenSkySource(Config{APIBaseURL: server.URL, TokenProvider: fixtureToken("fixture")})
	if err != nil {
		t.Fatal(err)
	}
	_, err = source.Fetch(context.Background(), testQuery(sources.LookupICAO24, "A1B2C3", 1))
	var typed *SourceError
	if !errors.As(err, &typed) || typed.Kind != ErrorPermissionRequired || calls.Load() != 0 {
		t.Fatalf("permission gate did not block request: err=%v calls=%d", err, calls.Load())
	}
	if source.Health().Status != "permission_required" || len(source.Capabilities().Lookups) != 0 {
		t.Fatalf("disabled source health/capabilities are misleading: %+v %+v", source.Health(), source.Capabilities())
	}
}

func TestEndpointConfigurationCannotRedirectProviderCredentialsToOtherHosts(t *testing.T) {
	for _, endpoint := range []string{"http://example.com/api", "https://attacker.invalid/api"} {
		if _, err := NewOpenSkySource(Config{APIBaseURL: endpoint}); err == nil {
			t.Fatalf("accepted untrusted API endpoint %q", endpoint)
		}
	}
	if _, err := NewOpenSkySource(Config{OAuthClientID: "client-only"}); err == nil {
		t.Fatal("accepted incomplete OAuth client credentials")
	}
}

func TestAreaQueryUsesOnlyResolvedBoundedBoundingBox(t *testing.T) {
	fixture := stateFixture(t)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		query := r.URL.Query()
		if len(query) != 4 || query.Get("lamin") != "47" || query.Get("lomin") != "8" || query.Get("lamax") != "48" || query.Get("lomax") != "9" {
			t.Errorf("unexpected bounded area query: %v", query)
		}
		_, _ = w.Write(fixture)
	}))
	defer server.Close()
	resolver := func(areaID string) (AreaBounds, bool) {
		return AreaBounds{MinLatitude: 47, MinLongitude: 8, MaxLatitude: 48, MaxLongitude: 9}, areaID == "DE"
	}
	source := newFixtureSource(t, server, Config{ResolveArea: resolver})
	if !source.Capabilities().Supports(sources.LookupArea) {
		t.Fatal("bounded area capability was not advertised")
	}
	if _, err := source.Fetch(context.Background(), testQuery(sources.LookupArea, "", 10)); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("area request count=%d, want 1", calls.Load())
	}
	tooWide := newFixtureSource(t, server, Config{ResolveArea: func(string) (AreaBounds, bool) {
		return AreaBounds{MinLatitude: 0, MinLongitude: 0, MaxLatitude: 10, MaxLongitude: 10}, true
	}})
	_, err := tooWide.Fetch(context.Background(), testQuery(sources.LookupArea, "", 10))
	var typed *SourceError
	if !errors.As(err, &typed) || typed.Kind != ErrorUnsupportedQuery || calls.Load() != 1 {
		t.Fatalf("unbounded box was not rejected before HTTP: err=%v calls=%d", err, calls.Load())
	}
}

func TestUnsupportedLookupNeverFallsBackToGlobalQuery(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer server.Close()
	source := newFixtureSource(t, server, Config{})
	for _, query := range []sources.Query{
		testQuery(sources.LookupCallsign, "UAL", 10),
		testQuery(sources.LookupRegistration, "N123AB", 10),
		{SourceID: openSkySourceID, Lookup: sources.LookupICAO24, CandidateLimit: 10},
	} {
		_, err := source.Fetch(context.Background(), query)
		var typed *SourceError
		if !errors.As(err, &typed) || typed.Kind != ErrorUnsupportedQuery {
			t.Fatalf("unsupported query accepted: %+v err=%v", query, err)
		}
	}
	if calls.Load() != 0 {
		t.Fatalf("unsupported queries caused %d network calls", calls.Load())
	}
}

func TestInvalidCoordinatesAndNullPositionProduceNoInventedPosition(t *testing.T) {
	body := strings.Replace(string(stateFixture(t)), "37.7749", "91.0", 1)
	if _, err := decodeStateVectors([]byte(body), 10); !hasErrorKind(err, ErrorInvalidPosition) {
		t.Fatalf("invalid coordinate was not a typed error: %v", err)
	}
	nullPosition := `{"time":1,"states":[["a1b2c3","UAL1","country",null,1,null,null,null,false,null,null,null,null,null,null,false,0]]}`
	items, err := decodeStateVectors([]byte(nullPosition), 10)
	if err != nil || len(items) != 0 {
		t.Fatalf("null position should be omitted without fabrication: items=%v err=%v", items, err)
	}
}

func TestRetryAfterIsHonoredOnceThenReturnsTypedRateLimit(t *testing.T) {
	fixture := stateFixture(t)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		_, _ = w.Write(fixture)
	}))
	defer server.Close()
	source := newFixtureSource(t, server, Config{})
	if _, err := source.Fetch(context.Background(), testQuery(sources.LookupICAO24, "A1B2C3", 10)); err != nil || calls.Load() != 2 {
		t.Fatalf("valid Retry-After was not retried once: calls=%d err=%v", calls.Load(), err)
	}

	calls.Store(0)
	limited := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.Header().Set("Retry-After", "invalid")
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer limited.Close()
	limitedSource := newFixtureSource(t, limited, Config{})
	_, err := limitedSource.Fetch(context.Background(), testQuery(sources.LookupICAO24, "A1B2C3", 10))
	if !hasErrorKind(err, ErrorRateLimited) || calls.Load() != 1 {
		t.Fatalf("missing/invalid Retry-After should remain typed and not spin: calls=%d err=%v", calls.Load(), err)
	}
}

func TestExpiredOAuthTokenRefreshesOnceOnUnauthorized(t *testing.T) {
	fixture := stateFixture(t)
	var tokenCalls, dataCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			call := tokenCalls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"synthetic-bearer-` + strconv.Itoa(int(call)) + `","expires_in":1800}`))
		case "/api/states/all":
			dataCalls.Add(1)
			if r.Header.Get("Authorization") == "Bearer synthetic-bearer-1" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_, _ = w.Write(fixture)
		default:
			t.Errorf("unexpected endpoint %s", r.URL.Path)
		}
	}))
	defer server.Close()
	source, err := NewOpenSkySource(Config{
		LicenseConfirmed: true, OAuthClientID: "synthetic-client", OAuthClientSecret: "synthetic-secret",
		APIBaseURL: server.URL + "/api", TokenURL: server.URL + "/token", HTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.Fetch(context.Background(), testQuery(sources.LookupICAO24, "A1B2C3", 10)); err != nil {
		t.Fatal(err)
	}
	if tokenCalls.Load() != 2 || dataCalls.Load() != 2 {
		t.Fatalf("token calls=%d data calls=%d, want one refresh and retry", tokenCalls.Load(), dataCalls.Load())
	}
}

func TestOAuthCredentialsAreCachedAndNeverIncludedInErrors(t *testing.T) {
	fixture := stateFixture(t)
	var tokenCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			tokenCalls.Add(1)
			if r.Method != http.MethodPost || r.FormValue("client_id") != "synthetic-client" || r.FormValue("client_secret") != "synthetic-secret" {
				t.Errorf("OAuth form was malformed")
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"synthetic-bearer","expires_in":1800}`))
		case "/api/states/all":
			if r.Header.Get("Authorization") != "Bearer synthetic-bearer" {
				t.Errorf("OAuth bearer token was not applied")
			}
			_, _ = w.Write(fixture)
		default:
			t.Errorf("unexpected endpoint %s", r.URL.Path)
		}
	}))
	defer server.Close()
	source, err := NewOpenSkySource(Config{
		LicenseConfirmed: true, OAuthClientID: "synthetic-client", OAuthClientSecret: "synthetic-secret",
		APIBaseURL: server.URL + "/api", TokenURL: server.URL + "/token", HTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := source.Fetch(context.Background(), testQuery(sources.LookupICAO24, "A1B2C3", 10)); err != nil {
			t.Fatal(err)
		}
	}
	if tokenCalls.Load() != 1 {
		t.Fatalf("token calls=%d, want cached token", tokenCalls.Load())
	}
}

func TestResponseBodyLimitAndTransportFailureRemainTyped(t *testing.T) {
	tooLarge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"states":[]}` + strings.Repeat(" ", 5000)))
	}))
	source := newFixtureSource(t, tooLarge, Config{MaxResponseBytes: 1024})
	_, err := source.Fetch(context.Background(), testQuery(sources.LookupICAO24, "A1B2C3", 10))
	tooLarge.Close()
	if !hasErrorKind(err, ErrorResultLimit) {
		t.Fatalf("oversized body error = %v", err)
	}

	disconnected := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hijacker, ok := w.(http.Hijacker)
		if !ok {
			t.Error("HTTP test server does not support hijacking")
			return
		}
		connection, _, err := hijacker.Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		_ = connection.Close()
	}))
	defer disconnected.Close()
	source = newFixtureSource(t, disconnected, Config{})
	_, err = source.Fetch(context.Background(), testQuery(sources.LookupICAO24, "A1B2C3", 10))
	if !hasErrorKind(err, ErrorTransport) {
		t.Fatalf("disconnect error = %v", err)
	}
}

func hasErrorKind(err error, kind ErrorKind) bool {
	var typed *SourceError
	return errors.As(err, &typed) && typed.Kind == kind
}

func TestRetryAfterParserSupportsDeltaAndDate(t *testing.T) {
	now := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	if value := parseRetryAfter("2", now); !value.Valid || value.Delay != 2*time.Second {
		t.Fatalf("delta retry-after parsed incorrectly: %+v", value)
	}
	if value := parseRetryAfter(now.Add(3*time.Second).Format(http.TimeFormat), now); !value.Valid || value.Delay != 3*time.Second {
		t.Fatalf("date retry-after parsed incorrectly: %+v", value)
	}
}
