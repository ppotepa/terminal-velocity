// Package decoding defines safe decoder contracts. It accepts declarative
// configuration only and never executes user-supplied code.
package decoding

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

type DecoderID string

func NewDecoderID(value string) (DecoderID, error) {
	id, err := shared.NewSourceID(value)
	return DecoderID(id), err
}

type DecodeStatus string

const (
	DecodeDecoded     DecodeStatus = "decoded"
	DecodePartial     DecodeStatus = "partial"
	DecodeUnknown     DecodeStatus = "unknown"
	DecodeUnsupported DecodeStatus = "unsupported"
)

type ValueType string

const (
	ValueString  ValueType = "string"
	ValueInteger ValueType = "integer"
	ValueNumber  ValueType = "number"
	ValueBoolean ValueType = "boolean"
	ValueTime    ValueType = "time"
)

type FieldDefinition struct {
	Name        string    `json:"name"`
	Type        ValueType `json:"type"`
	Description string    `json:"description,omitempty"`
	Unit        string    `json:"unit,omitempty"`
	Required    bool      `json:"required"`
}

type Capability struct {
	Bearers   []string `json:"bearers"`
	Protocols []string `json:"protocols"`
}

type DecoderDescriptor struct {
	ID         DecoderID         `json:"id"`
	Version    string            `json:"version"`
	Name       string            `json:"name"`
	Capability Capability        `json:"capability"`
	Fields     []FieldDefinition `json:"fields"`
}

var semver = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$`)
var fieldName = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

func (d DecoderDescriptor) Validate() error {
	if _, err := NewDecoderID(string(d.ID)); err != nil {
		return fmt.Errorf("decoder id: %w", err)
	}
	if !semver.MatchString(d.Version) {
		return shared.NewDomainError(shared.ErrInvalidInput, "decoder version must use semantic version form")
	}
	if strings.TrimSpace(d.Name) == "" || len(d.Name) > 120 {
		return shared.NewDomainError(shared.ErrInvalidInput, "decoder name must contain 1-120 characters")
	}
	if len(d.Capability.Bearers) == 0 || len(d.Capability.Bearers) > 8 || len(d.Capability.Protocols) == 0 || len(d.Capability.Protocols) > 32 {
		return shared.NewDomainError(shared.ErrInvalidInput, "decoder requires bounded bearer and protocol capabilities")
	}
	if len(d.Fields) == 0 || len(d.Fields) > 128 {
		return shared.NewDomainError(shared.ErrOutOfRange, "decoder must define 1-128 output fields")
	}
	seen := map[string]bool{}
	for _, field := range d.Fields {
		if !fieldName.MatchString(field.Name) || seen[field.Name] {
			return shared.NewDomainError(shared.ErrInvalidInput, "field names must be unique lowercase identifiers")
		}
		seen[field.Name] = true
		if field.Type != ValueString && field.Type != ValueInteger && field.Type != ValueNumber && field.Type != ValueBoolean && field.Type != ValueTime {
			return shared.NewDomainError(shared.ErrInvalidInput, "unsupported decoder field type")
		}
		if len(field.Description) > 512 || len(field.Unit) > 32 {
			return shared.NewDomainError(shared.ErrOutOfRange, "field description or unit is too long")
		}
	}
	return nil
}

type RuleOperator string

const (
	RuleEquals   RuleOperator = "equals"
	RulePrefix   RuleOperator = "prefix"
	RuleContains RuleOperator = "contains"
)

// MatchRule is a bounded declarative selector. It cannot contain executable
// expressions or arbitrary regular expressions.
type MatchRule struct {
	Field    string       `json:"field"`
	Operator RuleOperator `json:"operator"`
	Value    string       `json:"value"`
}

type DecoderConfig struct {
	DecoderID DecoderID   `json:"decoder_id"`
	Version   string      `json:"version"`
	Enabled   bool        `json:"enabled"`
	Rules     []MatchRule `json:"rules"`
}

func (c DecoderConfig) Validate(descriptor DecoderDescriptor) error {
	if err := descriptor.Validate(); err != nil {
		return fmt.Errorf("descriptor: %w", err)
	}
	if c.DecoderID != descriptor.ID || c.Version != descriptor.Version {
		return shared.NewDomainError(shared.ErrConflict, "configuration must target the exact decoder version")
	}
	if len(c.Rules) > 64 {
		return shared.NewDomainError(shared.ErrOutOfRange, "at most 64 declarative decoder rules are allowed")
	}
	fields := map[string]bool{}
	for _, field := range descriptor.Fields {
		fields[field.Name] = true
	}
	for i, rule := range c.Rules {
		if !fields[rule.Field] {
			return fmt.Errorf("rule %d: %w", i, shared.NewDomainError(shared.ErrInvalidInput, "rule references an unknown output field"))
		}
		if rule.Operator != RuleEquals && rule.Operator != RulePrefix && rule.Operator != RuleContains {
			return fmt.Errorf("rule %d: %w", i, shared.NewDomainError(shared.ErrInvalidInput, "unsupported declarative rule operator"))
		}
		if len(rule.Value) == 0 || len(rule.Value) > 256 {
			return fmt.Errorf("rule %d: %w", i, shared.NewDomainError(shared.ErrOutOfRange, "rule value must contain 1-256 characters"))
		}
	}
	return nil
}

type FieldValue struct {
	Name  string    `json:"name"`
	Type  ValueType `json:"type"`
	Value any       `json:"value"`
	Unit  string    `json:"unit,omitempty"`
}

type DecodeResult struct {
	Status         DecodeStatus `json:"status"`
	DecoderID      DecoderID    `json:"decoder_id,omitempty"`
	DecoderVersion string       `json:"decoder_version,omitempty"`
	Fields         []FieldValue `json:"fields,omitempty"`
	Original       string       `json:"original,omitempty"`
	Reason         string       `json:"reason"`
}

type MessageInput struct {
	SelectedDecoderIDs []DecoderID
	Bearer             string
	Protocol           string
	ContentAvailable   bool
	Encrypted          bool
	Original           string
}

type DecoderSelection struct {
	Descriptor DecoderDescriptor
	Config     DecoderConfig
}

// SelectDecoder applies only explicitly assigned, enabled decoders that support
// the message bearer and protocol. It does not decode or fetch messages.
func SelectDecoder(input MessageInput, decoders []DecoderSelection) (DecoderSelection, bool) {
	if !input.ContentAvailable || input.Encrypted {
		return DecoderSelection{}, false
	}
	assigned := map[DecoderID]bool{}
	for _, id := range input.SelectedDecoderIDs {
		assigned[id] = true
	}
	for _, candidate := range decoders {
		if !assigned[candidate.Descriptor.ID] || !candidate.Config.Enabled {
			continue
		}
		if candidate.Config.Validate(candidate.Descriptor) != nil {
			continue
		}
		if includesFold(candidate.Descriptor.Capability.Bearers, input.Bearer) && includesFold(candidate.Descriptor.Capability.Protocols, input.Protocol) {
			return candidate, true
		}
	}
	return DecoderSelection{}, false
}

func UnknownResult(input MessageInput) DecodeResult {
	if input.Encrypted {
		return DecodeResult{Status: DecodeUnknown, Original: input.Original, Reason: "encrypted_content_is_unreadable"}
	}
	if !input.ContentAvailable {
		return DecodeResult{Status: DecodeUnknown, Original: input.Original, Reason: "message_content_unavailable"}
	}
	return DecodeResult{Status: DecodeUnsupported, Original: input.Original, Reason: "no_assigned_decoder_supports_message"}
}

func ValidateResult(result DecodeResult, descriptor DecoderDescriptor) error {
	if err := descriptor.Validate(); err != nil {
		return err
	}
	if result.Status != DecodeDecoded && result.Status != DecodePartial && result.Status != DecodeUnknown && result.Status != DecodeUnsupported {
		return shared.NewDomainError(shared.ErrInvalidInput, "unsupported decode status")
	}
	if result.Status == DecodeUnknown || result.Status == DecodeUnsupported {
		if len(result.Fields) > 0 {
			return shared.NewDomainError(shared.ErrInvalidInput, "unknown or unsupported result cannot claim decoded fields")
		}
		return nil
	}
	if result.DecoderID != descriptor.ID || result.DecoderVersion != descriptor.Version {
		return shared.NewDomainError(shared.ErrConflict, "result decoder identity does not match descriptor")
	}
	allowed := map[string]FieldDefinition{}
	for _, field := range descriptor.Fields {
		allowed[field.Name] = field
	}
	seen := map[string]bool{}
	for _, value := range result.Fields {
		definition, ok := allowed[value.Name]
		if !ok || seen[value.Name] || value.Type != definition.Type || !valueMatchesType(value.Value, definition.Type) {
			return shared.NewDomainError(shared.ErrInvalidInput, "result contains undeclared or duplicate field")
		}
		seen[value.Name] = true
	}
	if result.Status == DecodeDecoded {
		for _, field := range descriptor.Fields {
			if field.Required && !seen[field.Name] {
				return fmt.Errorf("required field %s: %w", field.Name, shared.NewDomainError(shared.ErrInvalidInput, "missing required decoded field"))
			}
		}
	}
	return nil
}

func valueMatchesType(value any, kind ValueType) bool {
	switch kind {
	case ValueString:
		_, ok := value.(string)
		return ok
	case ValueBoolean:
		_, ok := value.(bool)
		return ok
	case ValueTime:
		_, ok := value.(time.Time)
		return ok
	case ValueInteger:
		switch value.(type) {
		case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
			return true
		}
	case ValueNumber:
		switch value.(type) {
		case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
			return true
		}
	}
	return false
}

func includesFold(values []string, sought string) bool {
	for _, value := range values {
		if strings.EqualFold(value, sought) {
			return true
		}
	}
	return false
}
