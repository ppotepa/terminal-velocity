package decoding

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/communications"
	core "github.com/ppotepa/terminal-velocity/backend/internal/core/decoding"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

type testProcessor struct{}

func (testProcessor) Descriptor() core.DecoderDescriptor {
	return core.DecoderDescriptor{ID: "acars-basic", Version: "1.0.0", Name: "test decoder", Capability: core.Capability{Bearers: []string{"vhf"}, Protocols: []string{"acars"}}, Fields: []core.FieldDefinition{{Name: "message_type", Type: core.ValueString, Required: true}}}
}
func (p testProcessor) Decode(text string, cfg core.DecoderConfig) (core.DecodeResult, error) {
	parts := strings.Fields(text)
	if len(parts) == 0 || len(parts[0]) != 2 {
		return core.DecodeResult{Status: core.DecodeUnsupported, DecoderID: p.Descriptor().ID, DecoderVersion: p.Descriptor().Version, Original: text, Reason: "acars_label_not_found"}, nil
	}
	label := strings.ToUpper(parts[0])
	for _, rule := range cfg.Rules {
		if rule.Field == "message_type" && (rule.Operator == core.RuleEquals && !strings.EqualFold(label, rule.Value) || rule.Operator == core.RulePrefix && !strings.HasPrefix(label, strings.ToUpper(rule.Value)) || rule.Operator == core.RuleContains && !strings.Contains(strings.ToUpper(label), strings.ToUpper(rule.Value))) {
			return core.DecodeResult{Status: core.DecodeUnsupported, DecoderID: p.Descriptor().ID, DecoderVersion: p.Descriptor().Version, Original: text, Reason: "configured_match_rules_not_satisfied"}, nil
		}
	}
	return core.DecodeResult{Status: core.DecodeDecoded, DecoderID: p.Descriptor().ID, DecoderVersion: p.Descriptor().Version, Original: text, Fields: []core.FieldValue{{Name: "message_type", Type: core.ValueString, Value: label}}}, nil
}

type testRegistry struct{ processor testProcessor }

func (r testRegistry) Get(id core.DecoderID) (Processor, bool) {
	if id != r.processor.Descriptor().ID {
		return nil, false
	}
	return r.processor, true
}
func (r testRegistry) All() []Processor { return []Processor{r.processor} }

type memoryRepo struct {
	configs map[core.DecoderID]StoredConfig
	results map[string]StoredResult
}

func newMemoryRepo() *memoryRepo {
	return &memoryRepo{configs: map[core.DecoderID]StoredConfig{}, results: map[string]StoredResult{}}
}
func (r *memoryRepo) GetConfig(_ context.Context, id core.DecoderID) (StoredConfig, error) {
	v, ok := r.configs[id]
	if !ok {
		return StoredConfig{}, ErrNotFound
	}
	return v, nil
}
func (r *memoryRepo) SaveConfig(_ context.Context, c core.DecoderConfig, expected int64, now time.Time) (StoredConfig, error) {
	old, ok := r.configs[c.DecoderID]
	if expected == 0 {
		if ok {
			return StoredConfig{}, ErrConflict
		}
		old = StoredConfig{Config: c, Revision: 1, UpdatedAt: now}
	} else {
		if !ok {
			return StoredConfig{}, ErrNotFound
		}
		if old.Revision != expected {
			return StoredConfig{}, ErrConflict
		}
		old = StoredConfig{Config: c, Revision: expected + 1, UpdatedAt: now}
	}
	r.configs[c.DecoderID] = old
	return old, nil
}
func (r *memoryRepo) SaveResult(_ context.Context, v StoredResult) (StoredResult, error) {
	k := fmt.Sprintf("%s/%s/%d/%s", v.MessageID, v.Result.DecoderID, v.ConfigRevision, v.Result.DecoderVersion)
	if old, ok := r.results[k]; ok {
		return old, nil
	}
	r.results[k] = v
	return v, nil
}
func (r *memoryRepo) ListResults(_ context.Context, q ResultQuery) ([]StoredResult, bool, error) {
	out := []StoredResult{}
	for _, v := range r.results {
		if v.MessageID == q.MessageID {
			out = append(out, v)
		}
	}
	if len(out) > q.Limit {
		return out[:q.Limit], true, nil
	}
	return out, false, nil
}

func testMessage(text, protocol string) communications.AircraftMessage {
	return communications.AircraftMessage{ID: "msg-1", Source: "fixture", SourceMessageRef: shared.Some("delivery-1"), CollectedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), Direction: communications.DirectionDownlink, Bearer: communications.BearerVHF, Protocol: protocol, ContentStatus: communications.ContentProviderDecoded, OriginalText: text}
}
func TestDecodeBuiltInAndUnknownMessagesWithoutChangingSourceText(t *testing.T) {
	repo := newMemoryRepo()
	registry := testRegistry{}
	svc := NewService(repo, repo, registry)
	if err := svc.EnsureDefaults(context.Background()); err != nil {
		t.Fatal(err)
	}
	id := core.DecoderID("acars-basic")
	response, err := svc.Decode(context.Background(), DecodeRequest{Message: testMessage("Q0 TV123 FLIGHT=TV123 MESSAGE=DOOR CHECK", "acars"), SelectedDecoderIDs: []core.DecoderID{id}})
	if err != nil || len(response.Results) != 1 {
		t.Fatalf("response=%+v err=%v", response, err)
	}
	result := response.Results[0].Result
	if result.Status != core.DecodeDecoded || result.Original != "Q0 TV123 FLIGHT=TV123 MESSAGE=DOOR CHECK" || len(result.Fields) != 1 {
		t.Fatalf("result=%+v", result)
	}
	unknownMessage := testMessage("unrecognized synthetic payload", "acars")
	unknownMessage.ID = "msg-2"
	unknown, err := svc.Decode(context.Background(), DecodeRequest{Message: unknownMessage, SelectedDecoderIDs: []core.DecoderID{id}})
	if err != nil || len(unknown.Results) != 1 || unknown.Results[0].Result.Status != core.DecodeUnsupported || unknown.Results[0].Result.Original != "unrecognized synthetic payload" {
		t.Fatalf("unknown=%+v err=%v", unknown, err)
	}
}

func TestDisabledConfigSkipsOutputAndChangedRuleCreatesNewVersionedDecode(t *testing.T) {
	ctx := context.Background()
	repo := newMemoryRepo()
	registry := testRegistry{}
	svc := NewService(repo, repo, registry)
	if err := svc.EnsureDefaults(ctx); err != nil {
		t.Fatal(err)
	}
	id := core.DecoderID("acars-basic")
	msg := testMessage("Q0 FLIGHT=TV123 MESSAGE=HELLO", "acars")
	first, err := svc.Decode(ctx, DecodeRequest{Message: msg, SelectedDecoderIDs: []core.DecoderID{id}})
	if err != nil || len(first.Results) != 1 || first.Results[0].ConfigRevision != 1 {
		t.Fatalf("first=%+v err=%v", first, err)
	}
	cfg, err := repo.GetConfig(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Config.Enabled = false
	if _, err = svc.Configure(ctx, cfg.Config, cfg.Revision); err != nil {
		t.Fatal(err)
	}
	disabled, err := svc.Decode(ctx, DecodeRequest{Message: msg, SelectedDecoderIDs: []core.DecoderID{id}})
	if err != nil || len(disabled.Results) != 0 || len(disabled.SkippedDecoderIDs) != 1 {
		t.Fatalf("disabled=%+v err=%v", disabled, err)
	}
	cfg, err = repo.GetConfig(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Config.Enabled = true
	cfg.Config.Rules = []core.MatchRule{{Field: "message_type", Operator: core.RuleEquals, Value: "Q2"}}
	if _, err = svc.Configure(ctx, cfg.Config, cfg.Revision); err != nil {
		t.Fatal(err)
	}
	redecoded, err := svc.Decode(ctx, DecodeRequest{Message: msg, SelectedDecoderIDs: []core.DecoderID{id}})
	if err != nil || len(redecoded.Results) != 1 || redecoded.Results[0].ConfigRevision != 3 || redecoded.Results[0].Result.Status != core.DecodeUnsupported {
		t.Fatalf("redecoded=%+v err=%v", redecoded, err)
	}
	history, err := svc.History(ctx, msg.ID, "", 10)
	if err != nil || len(history.Items) != 2 {
		t.Fatalf("history=%+v err=%v", history, err)
	}
}

func TestConfigureRejectsUnknownDecoderAndStaleRevision(t *testing.T) {
	ctx := context.Background()
	repo := newMemoryRepo()
	svc := NewService(repo, repo, testRegistry{})
	if _, err := svc.Configure(ctx, core.DecoderConfig{DecoderID: "missing", Version: "1.0.0", Enabled: true}, 0); err == nil {
		t.Fatal("accepted unknown decoder")
	}
	if err := svc.EnsureDefaults(ctx); err != nil {
		t.Fatal(err)
	}
	cfg, _ := repo.GetConfig(ctx, "acars-basic")
	if _, err := svc.Configure(ctx, cfg.Config, 0); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale create err=%v", err)
	}
}

func TestDecodeInputAndHistoryCursorAreBounded(t *testing.T) {
	ctx := context.Background()
	repo := newMemoryRepo()
	svc := NewService(repo, repo, testRegistry{})
	if err := svc.EnsureDefaults(ctx); err != nil {
		t.Fatal(err)
	}
	msg := testMessage(strings.Repeat("x", MaxDecodeInputBytes+1), "acars")
	if _, err := svc.Decode(ctx, DecodeRequest{Message: msg, SelectedDecoderIDs: []core.DecoderID{"acars-basic"}}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("oversized input err=%v", err)
	}
	if _, err := svc.History(ctx, "msg-1", "untrusted-cursor", 10); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("cursor err=%v", err)
	}
}
