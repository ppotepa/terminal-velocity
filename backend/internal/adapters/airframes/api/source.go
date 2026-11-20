// Package api defines an inactive, contract-compatible Airframes API source.
// It never creates an HTTP client or performs outbound requests.
package api

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/ports/sources"
)

const (
	SourceID   = "airframes-api"
	EnvEnabled = "TV_AIRFRAMES_API_ENABLED"
	EnvAPIKey  = "TV_AIRFRAMES_API_KEY"
)

type State string

const (
	StateDisabled      State = "disabled"
	StateNotConfigured State = "not_configured"
)

type ErrorKind string

const (
	ErrorDisabled      ErrorKind = "disabled"
	ErrorNotConfigured ErrorKind = "not_configured"
)

var (
	ErrDisabled      = errors.New("Airframes API source is disabled")
	ErrNotConfigured = errors.New("Airframes API source is not configured")
)

type SourceError struct {
	Kind     ErrorKind
	SourceID string
}

func (e *SourceError) Error() string {
	if e.Kind == ErrorDisabled {
		return "Airframes API source is disabled"
	}
	return "Airframes API source is not configured"
}
func (e *SourceError) Unwrap() error {
	if e.Kind == ErrorDisabled {
		return ErrDisabled
	}
	return ErrNotConfigured
}

// CredentialProvider is the future secret boundary for authorized API access.
// The inactive adapter does not call it or read credential values.
type CredentialProvider interface {
	APIKey(context.Context) (string, error)
}

type Config struct {
	Enabled     bool
	Credentials CredentialProvider
}
type Environment struct{ Enabled bool }

// LoadEnvironment reads only the enable switch. EnvAPIKey is reserved for a
// future credential provider and is intentionally not read by this stub.
func LoadEnvironment(getenv func(string) string) (Environment, error) {
	if getenv == nil {
		return Environment{}, fmt.Errorf("environment reader is required")
	}
	value := strings.TrimSpace(getenv(EnvEnabled))
	if value == "" {
		return Environment{Enabled: false}, nil
	}
	enabled, err := strconv.ParseBool(value)
	if err != nil {
		return Environment{}, fmt.Errorf("%s must be a boolean", EnvEnabled)
	}
	return Environment{Enabled: enabled}, nil
}

type Status struct {
	SourceID string `json:"source_id"`
	State    State  `json:"state"`
	Reason   string `json:"reason"`
}
type Source struct {
	config       Config
	capabilities sources.Capabilities
}

func New(config Config) *Source {
	return &Source{config: config, capabilities: sources.Capabilities{ID: SourceID, Lookups: []sources.LookupKind{sources.LookupICAO24, sources.LookupCallsign, sources.LookupRegistration}, RequestsPerWindow: 1, QuotaWindow: time.Minute, MinimumInterval: time.Second, RequestTimeout: 5 * time.Second, MaxResultsPerRequest: 100}}
}

func (s *Source) Capabilities() sources.Capabilities {
	out := s.capabilities
	out.Lookups = append([]sources.LookupKind(nil), s.capabilities.Lookups...)
	return out
}

func (s *Source) Status() Status {
	if !s.config.Enabled {
		return Status{SourceID: SourceID, State: StateDisabled, Reason: "TV_AIRFRAMES_API_ENABLED is false"}
	}
	return Status{SourceID: SourceID, State: StateNotConfigured, Reason: "API transport, credentials, provider permission and data terms are not configured"}
}

// Fetch is intentionally a tagged no-traffic stub. Even with Enabled set and a
// credential provider injected, no HTTP call is attempted until a later issue
// implements an authorized transport and payload decoder.
func (s *Source) Fetch(ctx context.Context, _ sources.Query) (sources.FetchResult, error) {
	if err := ctx.Err(); err != nil {
		return sources.FetchResult{}, err
	}
	state := s.Status()
	if state.State == StateDisabled {
		return sources.FetchResult{}, &SourceError{Kind: ErrorDisabled, SourceID: SourceID}
	}
	return sources.FetchResult{}, &SourceError{Kind: ErrorNotConfigured, SourceID: SourceID}
}

var _ sources.Source = (*Source)(nil)
