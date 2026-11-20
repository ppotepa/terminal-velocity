package bootstrap

import (
	"context"
	"testing"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/adapters/decoders"
	appdecode "github.com/ppotepa/terminal-velocity/backend/internal/application/decoding"
	coredecode "github.com/ppotepa/terminal-velocity/backend/internal/core/decoding"
	httpdecode "github.com/ppotepa/terminal-velocity/backend/internal/transport/http/decoders"
)

type configMemory struct {
	configs map[coredecode.DecoderID]appdecode.StoredConfig
	results int
}

func (m *configMemory) GetConfig(_ context.Context, id coredecode.DecoderID) (appdecode.StoredConfig, error) {
	v, ok := m.configs[id]
	if !ok {
		return appdecode.StoredConfig{}, appdecode.ErrNotFound
	}
	return v, nil
}
func (m *configMemory) SaveConfig(_ context.Context, c coredecode.DecoderConfig, expected int64, now time.Time) (appdecode.StoredConfig, error) {
	old, ok := m.configs[c.DecoderID]
	if ok && old.Revision != expected {
		return appdecode.StoredConfig{}, appdecode.ErrConflict
	}
	if !ok && expected != 0 {
		return appdecode.StoredConfig{}, appdecode.ErrNotFound
	}
	v := appdecode.StoredConfig{Config: c, Revision: expected + 1, UpdatedAt: now}
	if m.configs == nil {
		m.configs = map[coredecode.DecoderID]appdecode.StoredConfig{}
	}
	m.configs[c.DecoderID] = v
	return v, nil
}
func (m *configMemory) SaveResult(_ context.Context, v appdecode.StoredResult) (appdecode.StoredResult, error) {
	m.results++
	return v, nil
}
func (*configMemory) ListResults(context.Context, appdecode.ResultQuery) ([]appdecode.StoredResult, bool, error) {
	return nil, false, nil
}
func TestDecoderReaderUsesPersistedConfigAndPreviewsWithoutSavingResults(t *testing.T) {
	ctx := context.Background()
	repo := &configMemory{configs: map[coredecode.DecoderID]appdecode.StoredConfig{}}
	registry := decoders.NewRegistry()
	service := appdecode.NewService(repo, repo, registry)
	if err := service.EnsureDefaults(ctx); err != nil {
		t.Fatal(err)
	}
	reader := decoderReader{service: service, configs: repo, registry: registry}
	items, err := reader.ListDecoders(ctx)
	if err != nil || len(items) != 2 {
		t.Fatalf("items=%d err=%v", len(items), err)
	}
	payload := "Q0 UAL52 MESSAGE: SYNTHETIC"
	preview, err := reader.PreviewDecoder(ctx, "acars-basic", httpdecode.PreviewRequest{Payload: &payload, Protocol: "acars", Bearer: "vhf"})
	if err != nil || preview.Status != string(coredecode.DecodeDecoded) || repo.results != 0 {
		t.Fatalf("preview=%+v results=%d err=%v", preview, repo.results, err)
	}
	enabled := false
	updated, err := reader.UpdateDecoder(ctx, "acars-basic", httpdecode.Config{Version: "1.0.0", Enabled: &enabled, Rules: []httpdecode.MatchRule{}}, 1)
	if err != nil || updated.Enabled {
		t.Fatalf("decoder=%+v err=%v", updated, err)
	}
	preview, err = reader.PreviewDecoder(ctx, "acars-basic", httpdecode.PreviewRequest{Payload: &payload, Protocol: "acars", Bearer: "vhf"})
	if err != nil || preview.Status != string(coredecode.DecodeUnsupported) || preview.Reason != "decoder_disabled" {
		t.Fatalf("disabled preview=%+v error=%v", preview, err)
	}
}
