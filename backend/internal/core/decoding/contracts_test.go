package decoding

import "testing"

func descriptor() DecoderDescriptor {
	return DecoderDescriptor{ID: "acars-basic", Version: "1.2.0", Name: "ACARS text", Capability: Capability{Bearers: []string{"vhf"}, Protocols: []string{"acars"}}, Fields: []FieldDefinition{{Name: "message_type", Type: ValueString, Required: true}, {Name: "flight_number", Type: ValueString}}}
}

func TestDescriptorAndDeclarativeConfigValidation(t *testing.T) {
	d := descriptor()
	if err := d.Validate(); err != nil {
		t.Fatal(err)
	}
	cfg := DecoderConfig{DecoderID: d.ID, Version: d.Version, Enabled: true, Rules: []MatchRule{{Field: "message_type", Operator: RulePrefix, Value: "Q"}}}
	if err := cfg.Validate(d); err != nil {
		t.Fatal(err)
	}
	cfg.Rules[0].Operator = "regexp"
	if err := cfg.Validate(d); err == nil {
		t.Fatal("accepted executable/unbounded rule operator")
	}
	cfg.Rules[0] = MatchRule{Field: "unlisted", Operator: RuleEquals, Value: "x"}
	if err := cfg.Validate(d); err == nil {
		t.Fatal("accepted rule for undeclared field")
	}
	cfg.Rules = nil
	cfg.Version = "2.0"
	if err := cfg.Validate(d); err == nil {
		t.Fatal("accepted config for a different decoder version")
	}
}

func TestSelectionRequiresAssignmentAndCapability(t *testing.T) {
	d := descriptor()
	selection := DecoderSelection{Descriptor: d, Config: DecoderConfig{DecoderID: d.ID, Version: d.Version, Enabled: true}}
	input := MessageInput{SelectedDecoderIDs: []DecoderID{d.ID}, Bearer: "VHF", Protocol: "ACARS", ContentAvailable: true}
	if _, ok := SelectDecoder(input, []DecoderSelection{selection}); !ok {
		t.Fatal("failed selecting assigned capable decoder")
	}
	input.SelectedDecoderIDs = nil
	if _, ok := SelectDecoder(input, []DecoderSelection{selection}); ok {
		t.Fatal("selected a decoder that was not assigned")
	}
	input.SelectedDecoderIDs = []DecoderID{d.ID}
	input.Protocol = "VDL2"
	if _, ok := SelectDecoder(input, []DecoderSelection{selection}); ok {
		t.Fatal("selected decoder for unsupported protocol")
	}
	input.Protocol = "ACARS"
	input.Encrypted = true
	if _, ok := SelectDecoder(input, []DecoderSelection{selection}); ok {
		t.Fatal("selected decoder for encrypted input")
	}
}

func TestEncryptedAndUnavailableOutputCannotFabricateDecodedValues(t *testing.T) {
	encrypted := UnknownResult(MessageInput{Encrypted: true, Original: "opaque-ciphertext"})
	if encrypted.Status != DecodeUnknown || encrypted.Reason != "encrypted_content_is_unreadable" || len(encrypted.Fields) != 0 {
		t.Fatalf("unexpected encrypted result: %+v", encrypted)
	}
	if err := ValidateResult(encrypted, descriptor()); err != nil {
		t.Fatal(err)
	}
	unavailable := UnknownResult(MessageInput{})
	if unavailable.Status != DecodeUnknown || unavailable.Original != "" {
		t.Fatalf("unexpected unavailable result: %+v", unavailable)
	}
	unsupported := UnknownResult(MessageInput{ContentAvailable: true, Original: "unrecognized payload"})
	if unsupported.Status != DecodeUnsupported || unsupported.Original != "unrecognized payload" {
		t.Fatalf("original content should remain displayable: %+v", unsupported)
	}
	unsupported.Fields = []FieldValue{{Name: "message_type", Type: ValueString, Value: "fabricated"}}
	if err := ValidateResult(unsupported, descriptor()); err == nil {
		t.Fatal("unsupported result fabricated decoded field")
	}
}

func TestDecodeResultMustConformToSchema(t *testing.T) {
	d := descriptor()
	result := DecodeResult{Status: DecodeDecoded, DecoderID: d.ID, DecoderVersion: d.Version, Fields: []FieldValue{{Name: "message_type", Type: ValueString, Value: "Q0"}}}
	if err := ValidateResult(result, d); err != nil {
		t.Fatal(err)
	}
	result.Fields = nil
	if err := ValidateResult(result, d); err == nil {
		t.Fatal("decoded result omitted required schema field")
	}
	result.Status = DecodePartial
	if err := ValidateResult(result, d); err != nil {
		t.Fatalf("partial result may omit fields: %v", err)
	}
	result.Fields = []FieldValue{{Name: "undeclared", Type: ValueString, Value: "x"}}
	if err := ValidateResult(result, d); err == nil {
		t.Fatal("accepted undeclared field")
	}
	result.Fields = []FieldValue{{Name: "message_type", Type: ValueString, Value: 123}}
	if err := ValidateResult(result, d); err == nil {
		t.Fatal("accepted value that does not match declared field type")
	}
}

func TestDecoderDescriptorBounds(t *testing.T) {
	d := descriptor()
	d.Fields = make([]FieldDefinition, 129)
	if err := d.Validate(); err == nil {
		t.Fatal("accepted excessive field count")
	}
	d = descriptor()
	d.Version = "latest"
	if err := d.Validate(); err == nil {
		t.Fatal("accepted non-versioned decoder")
	}
}
