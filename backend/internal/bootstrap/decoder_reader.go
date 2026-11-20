package bootstrap

import (
	"context"
	"errors"
	"sort"

	appdecode "github.com/ppotepa/terminal-velocity/backend/internal/application/decoding"
	coredecode "github.com/ppotepa/terminal-velocity/backend/internal/core/decoding"
	httpdecode "github.com/ppotepa/terminal-velocity/backend/internal/transport/http/decoders"
)

type decoderReader struct {
	service  *appdecode.Service
	configs  appdecode.ConfigRepository
	registry appdecode.Registry
}

func (r decoderReader) ListDecoders(ctx context.Context) ([]httpdecode.Decoder, error) {
	processors := r.registry.All()
	out := make([]httpdecode.Decoder, 0, len(processors))
	for _, processor := range processors {
		d := processor.Descriptor()
		stored, err := r.configs.GetConfig(ctx, d.ID)
		if err != nil && !errors.Is(err, appdecode.ErrNotFound) {
			return nil, err
		}
		enabled := stored.Config.Enabled
		rules := make([]httpdecode.MatchRule, 0, len(stored.Config.Rules))
		for _, rule := range stored.Config.Rules {
			rules = append(rules, httpdecode.MatchRule{Field: rule.Field, Operator: string(rule.Operator), Value: rule.Value})
		}
		fields := make([]httpdecode.Field, 0, len(d.Fields))
		for _, f := range d.Fields {
			var unit *string
			if f.Unit != "" {
				u := f.Unit
				unit = &u
			}
			fields = append(fields, httpdecode.Field{Name: f.Name, Type: string(f.Type), Required: f.Required, Unit: unit})
		}
		out = append(out, httpdecode.Decoder{ID: string(d.ID), Version: d.Version, Name: d.Name, Enabled: enabled, Capabilities: httpdecode.Capabilities{Bearers: d.Capability.Bearers, Protocols: d.Capability.Protocols}, Fields: fields, Rules: rules, Revision: stored.Revision})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}
func (r decoderReader) UpdateDecoder(ctx context.Context, id string, input httpdecode.Config, expected int64) (httpdecode.Decoder, error) {
	enabled := false
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	rules := make([]coredecode.MatchRule, 0, len(input.Rules))
	for _, x := range input.Rules {
		rules = append(rules, coredecode.MatchRule{Field: x.Field, Operator: coredecode.RuleOperator(x.Operator), Value: x.Value})
	}
	if expected == 0 {
		current, getErr := r.configs.GetConfig(ctx, coredecode.DecoderID(id))
		if getErr != nil {
			if errors.Is(getErr, appdecode.ErrNotFound) {
				return httpdecode.Decoder{}, httpdecode.ErrNotFound
			}
			return httpdecode.Decoder{}, getErr
		}
		expected = current.Revision
	}
	stored, err := r.service.Configure(ctx, coredecode.DecoderConfig{DecoderID: coredecode.DecoderID(id), Version: input.Version, Enabled: enabled, Rules: rules}, expected)
	if errors.Is(err, appdecode.ErrNotFound) {
		return httpdecode.Decoder{}, httpdecode.ErrNotFound
	}
	if errors.Is(err, appdecode.ErrConflict) {
		return httpdecode.Decoder{}, httpdecode.ErrConflict
	}
	if err != nil {
		return httpdecode.Decoder{}, errors.Join(httpdecode.ErrInvalidInput, err)
	}
	descriptors := r.registry.All()
	for _, p := range descriptors {
		d := p.Descriptor()
		if string(d.ID) == id {
			return r.fromStored(d, stored.Config, stored.Revision), nil
		}
	}
	return httpdecode.Decoder{}, httpdecode.ErrNotFound
}
func (r decoderReader) PreviewDecoder(ctx context.Context, id string, input httpdecode.PreviewRequest) (httpdecode.DecodeResult, error) {
	processor, ok := r.registry.Get(coredecode.DecoderID(id))
	if !ok {
		return httpdecode.DecodeResult{}, httpdecode.ErrNotFound
	}
	descriptor := processor.Descriptor()
	stored, err := r.configs.GetConfig(ctx, descriptor.ID)
	if errors.Is(err, appdecode.ErrNotFound) {
		stored.Config = coredecode.DecoderConfig{DecoderID: descriptor.ID, Version: descriptor.Version, Enabled: true}
	} else if err != nil {
		return httpdecode.DecodeResult{}, err
	}
	if !stored.Config.Enabled {
		return httpdecode.DecodeResult{Status: string(coredecode.DecodeUnsupported), DecoderID: stringPtr(id), DecoderVersion: stringPtr(descriptor.Version), Original: input.Payload, Fields: []httpdecode.ResultField{}, Reason: "decoder_disabled"}, nil
	}
	if err := stored.Config.Validate(descriptor); err != nil {
		return httpdecode.DecodeResult{}, errors.Join(httpdecode.ErrInvalidInput, err)
	}
	decoded, err := processor.Decode(*input.Payload, stored.Config)
	if err != nil {
		return httpdecode.DecodeResult{}, errors.Join(httpdecode.ErrInvalidInput, err)
	}
	return toHTTPDecodeResult(decoded), nil
}
func (r decoderReader) fromStored(d coredecode.DecoderDescriptor, c coredecode.DecoderConfig, revision int64) httpdecode.Decoder {
	fields := make([]httpdecode.Field, 0, len(d.Fields))
	for _, f := range d.Fields {
		var unit *string
		if f.Unit != "" {
			v := f.Unit
			unit = &v
		}
		fields = append(fields, httpdecode.Field{Name: f.Name, Type: string(f.Type), Required: f.Required, Unit: unit})
	}
	rules := make([]httpdecode.MatchRule, 0, len(c.Rules))
	for _, x := range c.Rules {
		rules = append(rules, httpdecode.MatchRule{Field: x.Field, Operator: string(x.Operator), Value: x.Value})
	}
	return httpdecode.Decoder{ID: string(d.ID), Version: d.Version, Name: d.Name, Enabled: c.Enabled, Capabilities: httpdecode.Capabilities{Bearers: d.Capability.Bearers, Protocols: d.Capability.Protocols}, Fields: fields, Rules: rules, Revision: revision}
}
func toHTTPDecodeResult(v coredecode.DecodeResult) httpdecode.DecodeResult {
	fields := make([]httpdecode.ResultField, 0, len(v.Fields))
	for _, f := range v.Fields {
		var unit *string
		if f.Unit != "" {
			u := f.Unit
			unit = &u
		}
		fields = append(fields, httpdecode.ResultField{Name: f.Name, Type: string(f.Type), Value: f.Value, Unit: unit})
	}
	return httpdecode.DecodeResult{Status: string(v.Status), DecoderID: stringPtr(string(v.DecoderID)), DecoderVersion: stringPtr(v.DecoderVersion), Original: stringPtr(v.Original), Fields: fields, Reason: v.Reason}
}
func stringPtr(v string) *string { return &v }
