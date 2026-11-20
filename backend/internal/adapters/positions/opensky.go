// Package positions adapts permitted position providers into canonical observations.
package positions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/flight"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"github.com/ppotepa/terminal-velocity/backend/internal/ports/sources"
)

const (
	openSkySourceID        = "opensky"
	defaultAPIBaseURL      = "https://opensky-network.org/api"
	defaultTokenURL        = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
	defaultHTTPTimeout     = 8 * time.Second
	defaultResponseLimit   = 4 << 20
	maxConfiguredBodyLimit = 16 << 20
	maxConfiguredResults   = 2000
	maxConfiguredAreaLimit = 1000
	maxBoundingBoxArea     = 25.0
)

type ErrorKind string

const (
	ErrorPermissionRequired ErrorKind = "permission_required"
	ErrorNotConfigured      ErrorKind = "not_configured"
	ErrorUnsupportedQuery   ErrorKind = "unsupported_query"
	ErrorTransport          ErrorKind = "transport"
	ErrorHTTPStatus         ErrorKind = "http_status"
	ErrorRateLimited        ErrorKind = "rate_limited"
	ErrorInvalidResponse    ErrorKind = "invalid_response"
	ErrorInvalidPosition    ErrorKind = "invalid_position"
	ErrorResultLimit        ErrorKind = "result_limit_exceeded"
)

type SourceError struct {
	Kind       ErrorKind
	StatusCode int
	RetryAfter time.Duration
	cause      error
}

func (e *SourceError) Error() string {
	if e.StatusCode != 0 {
		return fmt.Sprintf("OpenSky source error: %s (HTTP %d)", e.Kind, e.StatusCode)
	}
	return "OpenSky source error: " + string(e.Kind)
}

func (e *SourceError) Unwrap() error { return e.cause }

func sourceError(kind ErrorKind, cause error) error { return &SourceError{Kind: kind, cause: cause} }

type TokenProvider interface {
	AccessToken(context.Context) (string, error)
}

type AreaBounds struct {
	MinLatitude  float64
	MinLongitude float64
	MaxLatitude  float64
	MaxLongitude float64
}

type AreaResolver func(areaID string) (AreaBounds, bool)

type Config struct {
	// LicenseConfirmed must be true only after the operator has verified an applicable written OpenSky license.
	LicenseConfirmed  bool
	TokenProvider     TokenProvider
	OAuthClientID     string
	OAuthClientSecret string
	APIBaseURL        string
	TokenURL          string
	HTTPClient        *http.Client
	ResolveArea       AreaResolver
	RequestsPerWindow int
	QuotaWindow       time.Duration
	MinimumInterval   time.Duration
	RequestTimeout    time.Duration
	MaxResults        int
	MaxAreaCandidates int
	MaxResponseBytes  int64
	MaxRetryAfter     time.Duration
}

type Health struct {
	Status        string
	LastCheckedAt time.Time
	LastErrorKind ErrorKind
}

type PositionRecord struct {
	ICAO24         shared.ICAO24              `json:"icao24"`
	Callsign       string                     `json:"callsign,omitempty"`
	Observation    flight.PositionObservation `json:"observation"`
	PositionSource string                     `json:"position_source,omitempty"`
	AltitudeKind   string                     `json:"altitude_kind,omitempty"`
}

type OpenSkySource struct {
	config        Config
	client        *http.Client
	baseURL       *url.URL
	tokenProvider TokenProvider
	healthMu      sync.RWMutex
	health        Health
}

// NewOpenSkySource configures the permission-gated OpenSky REST adapter.
func NewOpenSkySource(config Config) (*OpenSkySource, error) {
	if config.OAuthClientID != "" || config.OAuthClientSecret != "" {
		if config.OAuthClientID == "" || config.OAuthClientSecret == "" {
			return nil, fmt.Errorf("OpenSky OAuth client ID and secret must be configured together")
		}
	}
	if config.TokenProvider != nil && config.OAuthClientID != "" {
		return nil, fmt.Errorf("configure either a token provider or OAuth client credentials")
	}
	apiURL := config.APIBaseURL
	if apiURL == "" {
		apiURL = defaultAPIBaseURL
	}
	baseURL, err := parseEndpoint(apiURL, "opensky-network.org")
	if err != nil {
		return nil, fmt.Errorf("OpenSky API endpoint: %w", err)
	}
	if config.TokenURL == "" {
		config.TokenURL = defaultTokenURL
	}
	tokenURL, err := parseEndpoint(config.TokenURL, "auth.opensky-network.org")
	if err != nil {
		return nil, fmt.Errorf("OpenSky token endpoint: %w", err)
	}
	client := config.HTTPClient
	if client == nil {
		client = &http.Client{}
	} else {
		copy := *client
		client = &copy
	}
	if client.Timeout <= 0 || client.Timeout > 30*time.Second {
		client.Timeout = defaultHTTPTimeout
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if config.RequestsPerWindow <= 0 {
		config.RequestsPerWindow = 100
	}
	if config.QuotaWindow <= 0 {
		config.QuotaWindow = 24 * time.Hour
	}
	if config.MinimumInterval <= 0 {
		config.MinimumInterval = 10 * time.Second
	}
	if config.RequestTimeout <= 0 || config.RequestTimeout > 30*time.Second {
		config.RequestTimeout = defaultHTTPTimeout
	}
	if config.MaxResults <= 0 {
		config.MaxResults = 500
	}
	if config.MaxResults > maxConfiguredResults {
		return nil, fmt.Errorf("OpenSky maximum results cannot exceed %d", maxConfiguredResults)
	}
	if config.MaxAreaCandidates <= 0 {
		config.MaxAreaCandidates = min(100, config.MaxResults)
	}
	if config.MaxAreaCandidates > maxConfiguredAreaLimit || config.MaxAreaCandidates > config.MaxResults {
		return nil, fmt.Errorf("OpenSky area candidate limit cannot exceed %d or the request result limit", min(maxConfiguredAreaLimit, config.MaxResults))
	}
	if config.MaxResponseBytes <= 0 || config.MaxResponseBytes > maxConfiguredBodyLimit {
		config.MaxResponseBytes = defaultResponseLimit
	}
	if config.MaxRetryAfter <= 0 {
		config.MaxRetryAfter = 5 * time.Second
	}
	tokenProvider := config.TokenProvider
	if tokenProvider == nil && config.OAuthClientID != "" {
		tokenProvider = &ClientCredentialsTokenProvider{client: client, tokenURL: tokenURL.String(), clientID: config.OAuthClientID, clientSecret: config.OAuthClientSecret}
	}
	health := Health{Status: "permission_required"}
	if config.LicenseConfirmed {
		health.Status = "credentials_missing"
		if tokenProvider != nil {
			health.Status = "not_checked"
		}
	}
	return &OpenSkySource{config: config, client: client, baseURL: baseURL, tokenProvider: tokenProvider, health: health}, nil
}

func parseEndpoint(value, allowedHost string) (*url.URL, error) {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("must be an absolute HTTPS endpoint")
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && isLoopbackHost(parsed.Hostname())) {
		return nil, fmt.Errorf("must use HTTPS (HTTP is allowed only on loopback for offline fixtures)")
	}
	if !isLoopbackHost(parsed.Hostname()) && !strings.EqualFold(parsed.Hostname(), allowedHost) {
		return nil, fmt.Errorf("endpoint host is not an allowed OpenSky host")
	}
	return parsed, nil
}

func isLoopbackHost(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// Capabilities advertises only lookups that are both implemented and configured.
func (s *OpenSkySource) Capabilities() sources.Capabilities {
	capabilities := sources.Capabilities{
		ID: openSkySourceID, RequestsPerWindow: s.config.RequestsPerWindow, QuotaWindow: s.config.QuotaWindow,
		MinimumInterval: s.config.MinimumInterval, RequestTimeout: s.config.RequestTimeout,
		MaxResultsPerRequest: s.config.MaxResults, MaxCandidatesPerArea: s.config.MaxAreaCandidates,
	}
	if s.config.LicenseConfirmed && s.tokenProvider != nil {
		capabilities.Lookups = []sources.LookupKind{sources.LookupICAO24}
		if s.config.ResolveArea != nil {
			capabilities.Lookups = append(capabilities.Lookups, sources.LookupArea)
		}
	}
	return capabilities
}

// Health returns local permission/configuration state and the last request result.
func (s *OpenSkySource) Health() Health {
	s.healthMu.RLock()
	defer s.healthMu.RUnlock()
	return s.health
}

func (s *OpenSkySource) setHealth(status string, kind ErrorKind) {
	s.healthMu.Lock()
	defer s.healthMu.Unlock()
	s.health = Health{Status: status, LastCheckedAt: time.Now().UTC(), LastErrorKind: kind}
}

// Fetch issues one explicit serial or resolved bounded-area request and returns
// canonical position observations. It refuses all requests without permission.
func (s *OpenSkySource) Fetch(ctx context.Context, query sources.Query) (sources.FetchResult, error) {
	if !s.config.LicenseConfirmed {
		s.setHealth("permission_required", ErrorPermissionRequired)
		return sources.FetchResult{}, sourceError(ErrorPermissionRequired, nil)
	}
	if s.tokenProvider == nil {
		s.setHealth("credentials_missing", ErrorNotConfigured)
		return sources.FetchResult{}, sourceError(ErrorNotConfigured, nil)
	}
	maxCandidates := s.config.MaxResults
	if query.Lookup == sources.LookupArea {
		maxCandidates = s.config.MaxAreaCandidates
	}
	if query.SourceID != openSkySourceID || query.CandidateLimit < 1 || query.CandidateLimit > maxCandidates {
		return sources.FetchResult{}, sourceError(ErrorUnsupportedQuery, nil)
	}
	requestURL, err := s.requestURL(query)
	if err != nil {
		return sources.FetchResult{}, err
	}
	token, err := s.tokenProvider.AccessToken(ctx)
	if err != nil {
		kind := ErrorNotConfigured
		var typed *SourceError
		if errors.As(err, &typed) {
			kind = typed.Kind
		}
		s.setHealth("degraded", kind)
		return sources.FetchResult{}, sourceError(kind, nil)
	}
	body, status, retryAfter, err := s.get(ctx, requestURL, token)
	if err != nil {
		kind := ErrorTransport
		var typed *SourceError
		if errors.As(err, &typed) {
			kind = typed.Kind
		}
		s.setHealth("degraded", kind)
		return sources.FetchResult{}, err
	}
	if status == http.StatusUnauthorized {
		if invalidator, ok := s.tokenProvider.(interface{ Invalidate() }); ok {
			invalidator.Invalidate()
			refreshed, tokenErr := s.tokenProvider.AccessToken(ctx)
			if tokenErr != nil {
				s.setHealth("degraded", ErrorNotConfigured)
				return sources.FetchResult{}, sourceError(ErrorNotConfigured, nil)
			}
			token = refreshed
			body, status, retryAfter, err = s.get(ctx, requestURL, refreshed)
			if err != nil {
				s.setHealth("degraded", ErrorTransport)
				return sources.FetchResult{}, err
			}
		}
	}
	if status == http.StatusTooManyRequests {
		if retryAfter.Valid && retryAfter.Delay <= s.config.MaxRetryAfter {
			if err := waitRetryAfter(ctx, retryAfter.Delay); err != nil {
				return sources.FetchResult{}, sourceError(ErrorTransport, err)
			}
			body, status, retryAfter, err = s.get(ctx, requestURL, token)
			if err != nil {
				s.setHealth("degraded", ErrorTransport)
				return sources.FetchResult{}, err
			}
		}
	}
	if status == http.StatusTooManyRequests {
		s.setHealth("degraded", ErrorRateLimited)
		return sources.FetchResult{}, &SourceError{Kind: ErrorRateLimited, StatusCode: status, RetryAfter: retryAfter.Delay}
	}
	if status != http.StatusOK {
		kind := ErrorHTTPStatus
		if status == http.StatusUnauthorized || status == http.StatusForbidden {
			kind = ErrorNotConfigured
		}
		s.setHealth("degraded", kind)
		return sources.FetchResult{}, &SourceError{Kind: kind, StatusCode: status}
	}
	observations, err := decodeStateVectors(body, query.CandidateLimit)
	if err != nil {
		var typed *SourceError
		kind := ErrorInvalidResponse
		if errors.As(err, &typed) {
			kind = typed.Kind
		}
		s.setHealth("degraded", kind)
		return sources.FetchResult{}, err
	}
	records := make([]sources.Record, 0, len(observations))
	for _, observation := range observations {
		payload, err := json.Marshal(observation)
		if err != nil {
			s.setHealth("degraded", ErrorInvalidResponse)
			return sources.FetchResult{}, sourceError(ErrorInvalidResponse, err)
		}
		records = append(records, sources.Record{ObservedAt: observation.Observation.ObservedAt.Time, Payload: payload})
	}
	s.setHealth("ok", "")
	return sources.FetchResult{Records: records}, nil
}

func (s *OpenSkySource) requestURL(query sources.Query) (string, error) {
	endpoint := *s.baseURL
	endpoint.Path = strings.TrimRight(endpoint.Path, "/") + "/states/all"
	params := url.Values{}
	switch query.Lookup {
	case sources.LookupICAO24:
		if query.Prefix || query.AreaID != "" {
			return "", sourceError(ErrorUnsupportedQuery, nil)
		}
		icao24, err := shared.NewICAO24(query.Value)
		if err != nil {
			return "", sourceError(ErrorUnsupportedQuery, err)
		}
		params.Set("icao24", strings.ToLower(string(icao24)))
	case sources.LookupArea:
		if query.AreaID == "" || query.Value != "" || query.Prefix || s.config.ResolveArea == nil {
			return "", sourceError(ErrorUnsupportedQuery, nil)
		}
		bounds, ok := s.config.ResolveArea(query.AreaID)
		if !ok || !bounds.valid() || bounds.Area() > maxBoundingBoxArea {
			return "", sourceError(ErrorUnsupportedQuery, nil)
		}
		params.Set("lamin", strconv.FormatFloat(bounds.MinLatitude, 'f', -1, 64))
		params.Set("lomin", strconv.FormatFloat(bounds.MinLongitude, 'f', -1, 64))
		params.Set("lamax", strconv.FormatFloat(bounds.MaxLatitude, 'f', -1, 64))
		params.Set("lomax", strconv.FormatFloat(bounds.MaxLongitude, 'f', -1, 64))
	default:
		return "", sourceError(ErrorUnsupportedQuery, nil)
	}
	endpoint.RawQuery = params.Encode()
	return endpoint.String(), nil
}

func (s *OpenSkySource) get(ctx context.Context, requestURL, token string) ([]byte, int, retryAfterValue, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, 0, retryAfterValue{}, sourceError(ErrorTransport, err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := s.client.Do(request)
	if err != nil {
		return nil, 0, retryAfterValue{}, sourceError(ErrorTransport, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		if response.StatusCode == http.StatusTooManyRequests {
			return nil, response.StatusCode, parseRetryAfter(response.Header.Get("Retry-After"), time.Now()), nil
		}
		return nil, response.StatusCode, retryAfterValue{}, nil
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, s.config.MaxResponseBytes+1))
	if err != nil {
		return nil, response.StatusCode, retryAfterValue{}, sourceError(ErrorTransport, err)
	}
	if int64(len(body)) > s.config.MaxResponseBytes {
		return nil, response.StatusCode, retryAfterValue{}, sourceError(ErrorResultLimit, nil)
	}
	return body, response.StatusCode, retryAfterValue{}, nil
}

type retryAfterValue struct {
	Delay time.Duration
	Valid bool
}

func parseRetryAfter(header string, now time.Time) retryAfterValue {
	if seconds, err := strconv.Atoi(strings.TrimSpace(header)); err == nil && seconds >= 0 {
		return retryAfterValue{Delay: time.Duration(seconds) * time.Second, Valid: true}
	}
	if at, err := http.ParseTime(header); err == nil {
		return retryAfterValue{Delay: max(0, at.Sub(now)), Valid: true}
	}
	return retryAfterValue{}
}

func waitRetryAfter(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return ctx.Err()
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func decodeStateVectors(body []byte, maxResults int) ([]PositionRecord, error) {
	var response struct {
		Time   int64               `json:"time"`
		States [][]json.RawMessage `json:"states"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, sourceError(ErrorInvalidResponse, err)
	}
	observations := make([]PositionRecord, 0, min(len(response.States), maxResults))
	for _, state := range response.States {
		observation, ok, err := decodeStateVector(state)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		observations = append(observations, observation)
		if len(observations) > maxResults {
			return nil, sourceError(ErrorResultLimit, nil)
		}
	}
	return observations, nil
}

func decodeStateVector(state []json.RawMessage) (PositionRecord, bool, error) {
	if len(state) < 7 {
		return PositionRecord{}, false, sourceError(ErrorInvalidResponse, nil)
	}
	address, hasAddress, err := vectorString(state, 0)
	if err != nil || !hasAddress {
		return PositionRecord{}, false, sourceError(ErrorInvalidResponse, err)
	}
	icao24, err := shared.NewICAO24(address)
	if err != nil {
		return PositionRecord{}, false, sourceError(ErrorInvalidResponse, err)
	}
	longitude, hasLongitude, err := vectorFloat(state, 5)
	if err != nil {
		return PositionRecord{}, false, sourceError(ErrorInvalidPosition, err)
	}
	latitude, hasLatitude, err := vectorFloat(state, 6)
	if err != nil {
		return PositionRecord{}, false, sourceError(ErrorInvalidPosition, err)
	}
	if !hasLatitude && !hasLongitude {
		return PositionRecord{}, false, nil
	}
	if !hasLatitude || !hasLongitude || !finite(longitude) || !finite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90 {
		return PositionRecord{}, false, sourceError(ErrorInvalidPosition, nil)
	}
	if len(state) <= 3 {
		return PositionRecord{}, false, sourceError(ErrorInvalidResponse, nil)
	}
	positionTime, hasPositionTime, err := vectorInt64(state, 3)
	if err != nil {
		return PositionRecord{}, false, sourceError(ErrorInvalidResponse, err)
	}
	if !hasPositionTime {
		return PositionRecord{}, false, nil
	}
	observedAt, err := shared.NewObservationTime(time.Unix(positionTime, 0).UTC(), time.Second, 0)
	if err != nil {
		return PositionRecord{}, false, sourceError(ErrorInvalidResponse, err)
	}
	sourceID, _ := shared.NewSourceID(openSkySourceID)
	observation := flight.PositionObservation{
		SourceObservationID: fmt.Sprintf("opensky-%s-%d", icao24, positionTime),
		Source:              sourceID, ObservedAt: observedAt, Latitude: latitude, Longitude: longitude,
	}
	altitudeKind := ""
	if altitude, present, err := vectorFloat(state, 7); err != nil {
		return PositionRecord{}, false, sourceError(ErrorInvalidPosition, err)
	} else if present {
		observation.AltitudeMeters = shared.Some(altitude)
		altitudeKind = "barometric"
	} else if altitude, present, err := vectorFloat(state, 13); err != nil {
		return PositionRecord{}, false, sourceError(ErrorInvalidPosition, err)
	} else if present {
		observation.AltitudeMeters = shared.Some(altitude)
		altitudeKind = "geometric"
	}
	if speed, present, err := vectorFloat(state, 9); err != nil {
		return PositionRecord{}, false, sourceError(ErrorInvalidPosition, err)
	} else if present {
		observation.GroundSpeedMPS = shared.Some(speed)
	}
	if heading, present, err := vectorFloat(state, 10); err != nil {
		return PositionRecord{}, false, sourceError(ErrorInvalidPosition, err)
	} else if present {
		observation.HeadingDegrees = shared.Some(heading)
	}
	if _, err := flight.NewPositionObservation(observation); err != nil {
		return PositionRecord{}, false, sourceError(ErrorInvalidPosition, err)
	}
	callsign, _, _ := vectorString(state, 1)
	if normalized, err := shared.NewCallsign(callsign); err == nil {
		callsign = string(normalized)
	} else {
		callsign = ""
	}
	positionSource := ""
	if raw, ok := vectorIndex(state, 16); ok {
		var sourceKind int
		if json.Unmarshal(raw, &sourceKind) == nil {
			switch sourceKind {
			case 0:
				positionSource = "adsb"
			case 1:
				positionSource = "asterix"
			case 2:
				positionSource = "mlat"
			case 3:
				positionSource = "flarm"
			}
		}
	}
	return PositionRecord{ICAO24: icao24, Callsign: callsign, Observation: observation, PositionSource: positionSource, AltitudeKind: altitudeKind}, true, nil
}

func vectorIndex(state []json.RawMessage, index int) (json.RawMessage, bool) {
	if index < 0 || index >= len(state) || string(state[index]) == "null" {
		return nil, false
	}
	return state[index], true
}

func vectorString(state []json.RawMessage, index int) (string, bool, error) {
	raw, ok := vectorIndex(state, index)
	if !ok {
		return "", false, nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false, err
	}
	return strings.TrimSpace(value), true, nil
}

func vectorFloat(state []json.RawMessage, index int) (float64, bool, error) {
	raw, ok := vectorIndex(state, index)
	if !ok {
		return 0, false, nil
	}
	var value float64
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, false, err
	}
	if !finite(value) {
		return 0, true, fmt.Errorf("number is not finite")
	}
	return value, true, nil
}

func vectorInt64(state []json.RawMessage, index int) (int64, bool, error) {
	raw, ok := vectorIndex(state, index)
	if !ok {
		return 0, false, nil
	}
	var value int64
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, false, err
	}
	return value, true, nil
}

func (b AreaBounds) valid() bool {
	return finite(b.MinLatitude) && finite(b.MaxLatitude) && finite(b.MinLongitude) && finite(b.MaxLongitude) &&
		b.MinLatitude >= -90 && b.MaxLatitude <= 90 && b.MinLatitude < b.MaxLatitude &&
		b.MinLongitude >= -180 && b.MaxLongitude <= 180 && b.MinLongitude < b.MaxLongitude
}

func (b AreaBounds) Area() float64 {
	return (b.MaxLatitude - b.MinLatitude) * (b.MaxLongitude - b.MinLongitude)
}

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }
