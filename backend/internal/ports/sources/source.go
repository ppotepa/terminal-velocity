// Package sources defines provider-neutral acquisition and checkpoint contracts.
package sources

import (
	"context"
	"errors"
	"time"
)

type LookupKind string

const (
	LookupICAO24       LookupKind = "icao24"
	LookupCallsign     LookupKind = "callsign"
	LookupRegistration LookupKind = "registration"
	LookupArea         LookupKind = "area"
)

// Capabilities describe safe query bounds an adapter is able to honor.
type Capabilities struct {
	ID                     string
	Lookups                []LookupKind
	RequestsPerWindow      int
	QuotaWindow            time.Duration
	MinimumInterval        time.Duration
	RequestTimeout         time.Duration
	MaxResultsPerRequest   int
	MaxCandidatesPerArea   int
	SupportsCallsignPrefix bool
}

func (c Capabilities) Supports(kind LookupKind) bool {
	for _, supported := range c.Lookups {
		if supported == kind {
			return true
		}
	}
	return false
}

func (c Capabilities) Validate() error {
	if c.ID == "" || c.RequestsPerWindow < 1 || c.QuotaWindow <= 0 || c.MinimumInterval < 0 || c.RequestTimeout <= 0 || c.MaxResultsPerRequest < 1 {
		return errors.New("source capabilities require an ID, positive quota/window/timeout/result limit, and non-negative sampling interval")
	}
	for _, kind := range c.Lookups {
		switch kind {
		case LookupICAO24, LookupCallsign, LookupRegistration, LookupArea:
		default:
			return errors.New("source declares an unsupported lookup kind")
		}
	}
	if c.Supports(LookupArea) && c.MaxCandidatesPerArea < 1 {
		return errors.New("area lookup requires a positive candidate cap")
	}
	return nil
}

// Query is deliberately provider-neutral. Provider adapters translate it into
// their own API or UI request and must honor CandidateLimit and PollInterval.
type Query struct {
	Key            string
	SourceID       string
	Lookup         LookupKind
	Value          string
	Prefix         bool
	AreaID         string
	CandidateLimit int
	PollInterval   time.Duration
	RuleIDs        []string
	SinceToken     string
}

type Record struct {
	ObservedAt time.Time
	Payload    []byte
}

type FetchResult struct {
	Records         []Record
	CheckpointToken string
}

type Source interface {
	Capabilities() Capabilities
	Fetch(context.Context, Query) (FetchResult, error)
}

type Checkpoint struct {
	SourceID  string
	QueryKey  string
	Token     string
	UpdatedAt time.Time
}

type CheckpointStore interface {
	Load(context.Context, string, string) (Checkpoint, bool, error)
	Save(context.Context, Checkpoint) error
}
