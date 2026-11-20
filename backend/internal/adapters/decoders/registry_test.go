package decoders

import (
	"strings"
	"testing"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/decoding"
)

func TestACARSDecoderExtractsLabelFlightAndBody(t *testing.T) {
	registry := NewRegistry()
	processor, ok := registry.Get("acars-basic")
	if !ok {
		t.Fatal("missing built-in ACARS decoder")
	}
	input := "Q0 TV123 FLIGHT=TV123 MESSAGE=DOOR CHECK"
	result, err := processor.Decode(input, decoding.DecoderConfig{DecoderID: "acars-basic", Version: "1.0.0", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != decoding.DecodeDecoded || result.Original != input {
		t.Fatalf("result=%+v", result)
	}
	got := map[string]string{}
	for _, field := range result.Fields {
		got[field.Name] = field.Value.(string)
	}
	if got["message_type"] != "Q0" || got["flight_number"] != "TV123" || got["body"] != "DOOR CHECK" {
		t.Fatalf("fields=%v", got)
	}
}
func TestDeclarativeKeyValueDecoderAndBounds(t *testing.T) {
	registry := NewRegistry()
	processor, _ := registry.Get("key-value-text")
	input := "FLIGHT_NUMBER=TV123 ALTITUDE_FT=35000 LATITUDE=51.5 URGENT=true"
	result, err := processor.Decode(input, decoding.DecoderConfig{DecoderID: "key-value-text", Version: "1.0.0", Enabled: true})
	if err != nil || result.Status != decoding.DecodeDecoded {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if len(result.Fields) != 4 {
		t.Fatalf("fields=%+v", result.Fields)
	}
	if _, err := processor.Decode(strings.Repeat("x", MaxMessageBytes+1), decoding.DecoderConfig{DecoderID: "key-value-text", Version: "1.0.0", Enabled: true}); err == nil {
		t.Fatal("oversized input accepted")
	}
}
func TestDeclarativeRulesDoNotExecutePatterns(t *testing.T) {
	registry := NewRegistry()
	processor, _ := registry.Get("acars-basic")
	cfg := decoding.DecoderConfig{DecoderID: "acars-basic", Version: "1.0.0", Enabled: true, Rules: []decoding.MatchRule{{Field: "message_type", Operator: decoding.RuleEquals, Value: "Q2"}}}
	result, err := processor.Decode("Q0 HELLO", cfg)
	if err != nil || result.Status != decoding.DecodeUnsupported || result.Reason != "configured_match_rules_not_satisfied" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}
