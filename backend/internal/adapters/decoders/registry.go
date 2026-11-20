// Package decoders provides bounded built-in text decoders and a declarative key/value parser.
package decoders

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	application "github.com/ppotepa/terminal-velocity/backend/internal/application/decoding"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/decoding"
)

const MaxMessageBytes = 8192

var assignments = regexp.MustCompile(`(?:^|[\s,;])([A-Za-z][A-Za-z0-9_]{0,31})\s*[:=]\s*([^\s\r\n,;]{1,512})`)
var textAssignments = regexp.MustCompile(`(?i)(?:^|[\s,;])(MESSAGE|BODY|TEXT)\s*[:=]\s*([^\r\n,;]{1,512})`)
var labelPattern = regexp.MustCompile(`^[A-Za-z0-9]{2}$`)
var flightPattern = regexp.MustCompile(`^[A-Z]{2,3}[0-9]{1,4}[A-Z]?$`)

type Processor struct {
	descriptor decoding.DecoderDescriptor
	kind       string
}

func (p *Processor) Descriptor() decoding.DecoderDescriptor { return p.descriptor }
func (p *Processor) Decode(text string, cfg decoding.DecoderConfig) (decoding.DecodeResult, error) {
	if len(text) > MaxMessageBytes {
		return decoding.DecodeResult{}, fmt.Errorf("message exceeds %d-byte decoder limit", MaxMessageBytes)
	}
	var fields []decoding.FieldValue
	var reason string
	switch p.kind {
	case "acars":
		fields, reason = decodeACARS(text, p.descriptor)
	case "key_value":
		fields, reason = decodeKeyValue(text, p.descriptor)
	default:
		return decoding.DecodeResult{}, fmt.Errorf("decoder implementation missing")
	}
	if len(fields) == 0 {
		return decoding.DecodeResult{Status: decoding.DecodeUnsupported, DecoderID: p.descriptor.ID, DecoderVersion: p.descriptor.Version, Original: text, Reason: reason}, nil
	}
	if !rulesMatch(fields, cfg.Rules) {
		return decoding.DecodeResult{Status: decoding.DecodeUnsupported, DecoderID: p.descriptor.ID, DecoderVersion: p.descriptor.Version, Original: text, Reason: "configured_match_rules_not_satisfied"}, nil
	}
	status := decoding.DecodeDecoded
	for _, definition := range p.descriptor.Fields {
		if !definition.Required {
			continue
		}
		found := false
		for _, field := range fields {
			if field.Name == definition.Name {
				found = true
				break
			}
		}
		if !found {
			status = decoding.DecodePartial
			reason = "required_fields_missing"
		}
	}
	return decoding.DecodeResult{Status: status, DecoderID: p.descriptor.ID, DecoderVersion: p.descriptor.Version, Fields: fields, Original: text, Reason: reason}, nil
}

type Registry struct {
	items map[decoding.DecoderID]*Processor
}

func NewRegistry() *Registry {
	acars := decoding.DecoderDescriptor{ID: "acars-basic", Version: "1.0.0", Name: "ACARS label and fields", Capability: decoding.Capability{Bearers: []string{"hf", "vhf", "satcom"}, Protocols: []string{"acars"}}, Fields: []decoding.FieldDefinition{{Name: "message_type", Type: decoding.ValueString, Description: "Two-character ACARS message label", Required: true}, {Name: "flight_number", Type: decoding.ValueString, Description: "Flight designator when present"}, {Name: "body", Type: decoding.ValueString, Description: "Message body or supplied MESSAGE field"}}}
	keyValue := decoding.DecoderDescriptor{ID: "key-value-text", Version: "1.0.0", Name: "Bounded key/value text", Capability: decoding.Capability{Bearers: []string{"hf", "vhf", "satcom"}, Protocols: []string{"acars", "vdlm2", "hfdl", "text"}}, Fields: []decoding.FieldDefinition{{Name: "flight_number", Type: decoding.ValueString, Required: false}, {Name: "message_type", Type: decoding.ValueString, Required: false}, {Name: "body", Type: decoding.ValueString, Required: false}, {Name: "altitude_ft", Type: decoding.ValueInteger, Unit: "ft", Required: false}, {Name: "latitude", Type: decoding.ValueNumber, Unit: "degrees", Required: false}, {Name: "longitude", Type: decoding.ValueNumber, Unit: "degrees", Required: false}, {Name: "urgent", Type: decoding.ValueBoolean, Required: false}, {Name: "observed_at", Type: decoding.ValueTime, Required: false}}}
	return &Registry{items: map[decoding.DecoderID]*Processor{acars.ID: {descriptor: acars, kind: "acars"}, keyValue.ID: {descriptor: keyValue, kind: "key_value"}}}
}
func (r *Registry) Get(id decoding.DecoderID) (application.Processor, bool) {
	p, ok := r.items[id]
	return p, ok
}
func (r *Registry) All() []application.Processor {
	out := make([]application.Processor, 0, len(r.items))
	for _, p := range r.items {
		out = append(out, p)
	}
	return out
}

func decodeACARS(text string, d decoding.DecoderDescriptor) ([]decoding.FieldValue, string) {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return nil, "empty_message"
	}
	tokens := strings.Fields(trimmed)
	var label string
	if len(tokens) > 0 && labelPattern.MatchString(tokens[0]) {
		label = strings.ToUpper(tokens[0])
	}
	if label == "" {
		for _, match := range assignments.FindAllStringSubmatch(trimmed, 32) {
			if strings.EqualFold(match[1], "message_type") {
				label = strings.ToUpper(strings.TrimSpace(match[2]))
				break
			}
		}
	}
	if label == "" {
		return nil, "acars_label_not_found"
	}
	fields := []decoding.FieldValue{{Name: "message_type", Type: decoding.ValueString, Value: label}}
	hasFlight := false
	for _, token := range tokens[1:] {
		candidate := strings.ToUpper(strings.Trim(token, "()[]{}<>"))
		if flightPattern.MatchString(candidate) {
			fields = append(fields, decoding.FieldValue{Name: "flight_number", Type: decoding.ValueString, Value: candidate})
			hasFlight = true
			break
		}
	}
	for _, match := range assignments.FindAllStringSubmatch(trimmed, 32) {
		key, value := strings.ToUpper(match[1]), strings.TrimSpace(match[2])
		if value == "" {
			continue
		}
		switch key {
		case "FLIGHT", "FLIGHT_NUMBER", "FLT", "CALLSIGN":
			if hasFlight {
				continue
			}
			fields = append(fields, decoding.FieldValue{Name: "flight_number", Type: decoding.ValueString, Value: value})
			hasFlight = true
		}
	}
	for _, match := range textAssignments.FindAllStringSubmatch(trimmed, 1) {
		value := strings.TrimSpace(match[2])
		if value != "" {
			fields = append(fields, decoding.FieldValue{Name: "body", Type: decoding.ValueString, Value: value})
		}
	}
	if len(fields) == 1 {
		rest := strings.TrimSpace(strings.TrimPrefix(trimmed, tokens[0]))
		if rest != "" {
			if len(rest) > 512 {
				rest = rest[:512]
			}
			fields = append(fields, decoding.FieldValue{Name: "body", Type: decoding.ValueString, Value: rest})
		}
	}
	return fields, ""
}
func decodeKeyValue(text string, d decoding.DecoderDescriptor) ([]decoding.FieldValue, string) {
	defs := map[string]decoding.FieldDefinition{}
	for _, field := range d.Fields {
		defs[field.Name] = field
	}
	out := []decoding.FieldValue{}
	seen := map[string]bool{}
	for _, match := range assignments.FindAllStringSubmatch(text, 64) {
		name := strings.ToLower(match[1])
		def, ok := defs[name]
		if !ok {
			continue
		}
		if seen[name] {
			continue
		}
		raw := strings.TrimSpace(match[2])
		value, ok := parseValue(raw, def.Type)
		if !ok {
			continue
		}
		out = append(out, decoding.FieldValue{Name: name, Type: def.Type, Value: value, Unit: def.Unit})
		seen[name] = true
	}
	if len(out) == 0 {
		return nil, "no_declared_key_value_fields_found"
	}
	return out, ""
}
func parseValue(raw string, kind decoding.ValueType) (any, bool) {
	switch kind {
	case decoding.ValueString:
		return raw, true
	case decoding.ValueInteger:
		v, e := strconv.ParseInt(raw, 10, 64)
		return v, e == nil
	case decoding.ValueNumber:
		v, e := strconv.ParseFloat(raw, 64)
		return v, e == nil && !math.IsNaN(v) && !math.IsInf(v, 0)
	case decoding.ValueBoolean:
		v, e := strconv.ParseBool(strings.ToLower(raw))
		return v, e == nil
	case decoding.ValueTime:
		v, e := time.Parse(time.RFC3339, raw)
		return v.UTC(), e == nil
	}
	return nil, false
}
func rulesMatch(fields []decoding.FieldValue, rules []decoding.MatchRule) bool {
	for _, rule := range rules {
		found := false
		for _, field := range fields {
			if field.Name != rule.Field {
				continue
			}
			value := fmt.Sprint(field.Value)
			switch rule.Operator {
			case decoding.RuleEquals:
				found = strings.EqualFold(value, rule.Value)
			case decoding.RulePrefix:
				found = strings.HasPrefix(strings.ToUpper(value), strings.ToUpper(rule.Value))
			case decoding.RuleContains:
				found = strings.Contains(strings.ToUpper(value), strings.ToUpper(rule.Value))
			}
			break
		}
		if !found {
			return false
		}
	}
	return true
}

var _ application.Processor = (*Processor)(nil)
