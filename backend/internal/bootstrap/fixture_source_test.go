package bootstrap

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/ports/sources"
)

func TestFixtureSourceReturnsDeterministicBoundedCallsSignObservation(t *testing.T) {
	source := fixtureSource{}
	caps := source.Capabilities()
	if err := caps.Validate(); err != nil {
		t.Fatal(err)
	}
	query := sources.Query{Key: "fixture-key", SourceID: caps.ID, Lookup: sources.LookupCallsign, Value: "SMOKE", Prefix: true, CandidateLimit: 1}
	first, err := source.Fetch(context.Background(), query)
	if err != nil {
		t.Fatal(err)
	}
	second, err := source.Fetch(context.Background(), query)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Records) != 1 || first.CheckpointToken == "" || first.CheckpointToken != second.CheckpointToken {
		t.Fatalf("unexpected fixture response: %+v", first)
	}
	var item fixtureObservation
	if err := json.Unmarshal(first.Records[0].Payload, &item); err != nil {
		t.Fatal(err)
	}
	if item.Callsign != "SMOKE42" || item.ICAO24 == "" || !item.ObservedAt.Equal(first.Records[0].ObservedAt) || time.Since(item.ObservedAt) > 2*time.Minute {
		t.Fatalf("invalid fixture observation: %+v", item)
	}
}
