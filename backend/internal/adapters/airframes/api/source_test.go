package api

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/ports/sources"
)

type credentialSpy struct{ calls int }

func (c *credentialSpy) APIKey(context.Context) (string, error) {
	c.calls++
	return "synthetic-secret", nil
}

func TestDefaultEnvironmentAndInactiveFetchAreTagged(t *testing.T) {
	env, err := LoadEnvironment(func(key string) string {
		if key == EnvAPIKey {
			t.Fatal("stub must not read credentials")
		}
		return ""
	})
	if err != nil || env.Enabled {
		t.Fatalf("environment=%+v err=%v", env, err)
	}
	source := New(Config{Enabled: env.Enabled})
	if status := source.Status(); status.State != StateDisabled || status.SourceID != SourceID {
		t.Fatalf("status=%+v", status)
	}
	_, err = source.Fetch(context.Background(), sources.Query{})
	if !errors.Is(err, ErrDisabled) {
		t.Fatalf("fetch error=%v", err)
	}
	var tagged *SourceError
	if !errors.As(err, &tagged) || tagged.Kind != ErrorDisabled || tagged.SourceID != SourceID {
		t.Fatalf("tagged error=%+v", tagged)
	}
}

func TestEnabledSourceWithoutTransportStaysNotConfigured(t *testing.T) {
	creds := &credentialSpy{}
	source := New(Config{Enabled: true, Credentials: creds})
	if got := source.Status().State; got != StateNotConfigured {
		t.Fatalf("status=%s", got)
	}
	result, err := source.Fetch(context.Background(), sources.Query{Lookup: sources.LookupICAO24, Value: "A1B2C3"})
	if !errors.Is(err, ErrNotConfigured) || len(result.Records) != 0 {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if creds.calls != 0 {
		t.Fatalf("credential provider was called %d times", creds.calls)
	}
}

func TestEnvironmentParsingAndCapabilities(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  bool
	}{{"true", true}, {"1", true}, {"false", false}} {
		env, err := LoadEnvironment(func(key string) string {
			if key == EnvEnabled {
				return tc.value
			}
			return ""
		})
		if err != nil || env.Enabled != tc.want {
			t.Fatalf("value=%q env=%+v err=%v", tc.value, env, err)
		}
	}
	if _, err := LoadEnvironment(func(string) string { return "sometimes" }); err == nil {
		t.Fatal("invalid enable value was accepted")
	}
	caps := New(Config{}).Capabilities()
	if err := caps.Validate(); err != nil {
		t.Fatal(err)
	}
	if caps.ID != SourceID || !caps.Supports(sources.LookupICAO24) || !caps.Supports(sources.LookupCallsign) || !caps.Supports(sources.LookupRegistration) || caps.Supports(sources.LookupArea) || caps.SupportsCallsignPrefix {
		t.Fatalf("capabilities=%+v", caps)
	}
	if caps.RequestsPerWindow != 1 || caps.QuotaWindow != time.Minute || caps.MaxResultsPerRequest != 100 {
		t.Fatalf("stub bounds=%+v", caps)
	}
}

func TestCanceledFetchDoesNotReturnStubStatusInsteadOfCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := New(Config{}).Fetch(ctx, sources.Query{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("fetch error=%v", err)
	}
}
