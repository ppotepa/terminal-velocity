// Package decoding coordinates versioned decoder configuration and message results.
package decoding

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/communications"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/decoding"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

var (
	ErrNotFound       = errors.New("decoder configuration not found")
	ErrConflict       = errors.New("decoder configuration revision conflict")
	ErrInvalidRequest = errors.New("invalid decoder request")
)

const (
	MaxSelectedDecoders = 32
	MaxDecodeInputBytes = 8192
	MaxResultPage       = 200
	DefaultResultPage   = 50
)

type StoredConfig struct {
	Config    decoding.DecoderConfig `json:"config" bson:"config"`
	Revision  int64                  `json:"revision" bson:"revision"`
	UpdatedAt time.Time              `json:"updated_at" bson:"updated_at"`
}
type StoredResult struct {
	MessageID      shared.MessageID      `json:"message_id" bson:"message_id"`
	ConfigRevision int64                 `json:"config_revision" bson:"config_revision"`
	Result         decoding.DecodeResult `json:"result" bson:"result"`
	CreatedAt      time.Time             `json:"created_at" bson:"created_at"`
}
type ResultQuery struct {
	MessageID shared.MessageID
	After     string
	Limit     int
}
type ResultPage struct {
	Items []StoredResult          `json:"items"`
	Next  shared.Optional[string] `json:"next,omitempty"`
}
type ConfigRepository interface {
	GetConfig(context.Context, decoding.DecoderID) (StoredConfig, error)
	SaveConfig(context.Context, decoding.DecoderConfig, int64, time.Time) (StoredConfig, error)
}
type ResultRepository interface {
	SaveResult(context.Context, StoredResult) (StoredResult, error)
	ListResults(context.Context, ResultQuery) ([]StoredResult, bool, error)
}
type Processor interface {
	Descriptor() decoding.DecoderDescriptor
	Decode(string, decoding.DecoderConfig) (decoding.DecodeResult, error)
}
type Registry interface {
	Get(decoding.DecoderID) (Processor, bool)
	All() []Processor
}
type DecodeRequest struct {
	Message            communications.AircraftMessage
	SelectedDecoderIDs []decoding.DecoderID
}
type DecodeResponse struct {
	Results           []StoredResult       `json:"results"`
	SkippedDecoderIDs []decoding.DecoderID `json:"skipped_decoder_ids,omitempty"`
}
type Service struct {
	configs  ConfigRepository
	results  ResultRepository
	registry Registry
	now      func() time.Time
}

func NewService(configs ConfigRepository, results ResultRepository, registry Registry) *Service {
	return &Service{configs: configs, results: results, registry: registry, now: func() time.Time { return time.Now().UTC() }}
}

// EnsureDefaults installs enabled, empty declarative configurations for built-in decoders that have no saved config.
func (s *Service) EnsureDefaults(ctx context.Context) error {
	for _, processor := range s.registry.All() {
		descriptor := processor.Descriptor()
		cfg := decoding.DecoderConfig{DecoderID: descriptor.ID, Version: descriptor.Version, Enabled: true}
		if _, err := s.configs.GetConfig(ctx, descriptor.ID); err == nil {
			continue
		} else if !errors.Is(err, ErrNotFound) {
			return err
		}
		if _, err := s.configs.SaveConfig(ctx, cfg, 0, s.now().UTC()); err != nil && !errors.Is(err, ErrConflict) {
			return err
		}
	}
	return nil
}

func (s *Service) Configure(ctx context.Context, cfg decoding.DecoderConfig, expectedRevision int64) (StoredConfig, error) {
	processor, ok := s.registry.Get(cfg.DecoderID)
	if !ok {
		return StoredConfig{}, fmt.Errorf("unknown decoder %q", cfg.DecoderID)
	}
	if err := cfg.Validate(processor.Descriptor()); err != nil {
		return StoredConfig{}, err
	}
	if expectedRevision < 0 {
		return StoredConfig{}, ErrInvalidRequest
	}
	return s.configs.SaveConfig(ctx, cfg, expectedRevision, s.now().UTC())
}

// Decode processes only explicit decoder assignments. Original is passed through unchanged and is never rewritten.
func (s *Service) Decode(ctx context.Context, req DecodeRequest) (DecodeResponse, error) {
	message, err := communications.NewAircraftMessage(req.Message)
	if err != nil {
		return DecodeResponse{}, err
	}
	if len(message.OriginalText) > MaxDecodeInputBytes {
		return DecodeResponse{}, ErrInvalidRequest
	}
	if len(req.SelectedDecoderIDs) > MaxSelectedDecoders {
		return DecodeResponse{}, ErrInvalidRequest
	}
	ids := append([]decoding.DecoderID(nil), req.SelectedDecoderIDs...)
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for i, id := range ids {
		if _, e := decoding.NewDecoderID(string(id)); e != nil {
			return DecodeResponse{}, e
		}
		if i > 0 && ids[i-1] == id {
			return DecodeResponse{}, ErrInvalidRequest
		}
	}
	response := DecodeResponse{Results: []StoredResult{}, SkippedDecoderIDs: []decoding.DecoderID{}}
	for _, id := range ids {
		processor, ok := s.registry.Get(id)
		if !ok {
			response.SkippedDecoderIDs = append(response.SkippedDecoderIDs, id)
			continue
		}
		stored, err := s.configs.GetConfig(ctx, id)
		if errors.Is(err, ErrNotFound) {
			response.SkippedDecoderIDs = append(response.SkippedDecoderIDs, id)
			continue
		}
		if err != nil {
			return DecodeResponse{}, err
		}
		if !stored.Config.Enabled {
			response.SkippedDecoderIDs = append(response.SkippedDecoderIDs, id)
			continue
		}
		descriptor := processor.Descriptor()
		input := decoding.MessageInput{SelectedDecoderIDs: []decoding.DecoderID{id}, Bearer: string(message.Bearer), Protocol: message.Protocol, ContentAvailable: message.ContentStatus != communications.ContentUnavailable, Encrypted: message.ContentStatus == communications.ContentEncrypted, Original: message.OriginalText}
		var result decoding.DecodeResult
		if configErr := stored.Config.Validate(descriptor); configErr != nil {
			result = decoding.DecodeResult{Status: decoding.DecodeUnknown, DecoderID: descriptor.ID, DecoderVersion: descriptor.Version, Original: message.OriginalText, Reason: "decoder_configuration_invalid"}
		} else if selection, selected := decoding.SelectDecoder(input, []decoding.DecoderSelection{{Descriptor: descriptor, Config: stored.Config}}); !selected {
			result = decoding.UnknownResult(input)
		} else {
			result, err = processor.Decode(message.OriginalText, selection.Config)
			if err != nil {
				result = decoding.DecodeResult{Status: decoding.DecodeUnknown, DecoderID: descriptor.ID, DecoderVersion: descriptor.Version, Original: message.OriginalText, Reason: boundedFailure(err)}
			}
		}
		if result.DecoderID == "" {
			result.DecoderID = descriptor.ID
			result.DecoderVersion = descriptor.Version
		}
		if result.Status == decoding.DecodeUnknown || result.Status == decoding.DecodeUnsupported {
			if result.Original == "" {
				result.Original = message.OriginalText
			}
			if result.Reason == "" {
				result.Reason = "message_not_decodable"
			}
		}
		if result.Status == decoding.DecodeDecoded || result.Status == decoding.DecodePartial {
			result.DecoderID = descriptor.ID
			result.DecoderVersion = descriptor.Version
		}
		if err := decoding.ValidateResult(result, descriptor); err != nil {
			result = decoding.DecodeResult{Status: decoding.DecodeUnknown, DecoderID: descriptor.ID, DecoderVersion: descriptor.Version, Original: message.OriginalText, Reason: "decoder_result_invalid"}
		}
		record := StoredResult{MessageID: message.ID, ConfigRevision: stored.Revision, Result: result, CreatedAt: s.now().UTC()}
		saved, err := s.results.SaveResult(ctx, record)
		if err != nil {
			return DecodeResponse{}, err
		}
		response.Results = append(response.Results, saved)
	}
	return response, nil
}
func boundedFailure(err error) string {
	const max = 256
	message := err.Error()
	if len(message) > max {
		message = message[:max]
	}
	return "decoder_execution_failed: " + message
}

func (s *Service) History(ctx context.Context, messageID shared.MessageID, after string, limit int) (ResultPage, error) {
	if _, err := shared.NewMessageID(string(messageID)); err != nil {
		return ResultPage{}, err
	}
	if limit == 0 {
		limit = DefaultResultPage
	}
	if limit < 1 || limit > MaxResultPage {
		return ResultPage{}, ErrInvalidRequest
	}
	if after != "" {
		if len(after) != len("decode_")+sha256.Size*2 || after[:len("decode_")] != "decode_" {
			return ResultPage{}, ErrInvalidRequest
		}
		if _, err := hex.DecodeString(after[len("decode_"):]); err != nil {
			return ResultPage{}, ErrInvalidRequest
		}
	}
	items, more, err := s.results.ListResults(ctx, ResultQuery{MessageID: messageID, After: after, Limit: limit})
	if err != nil {
		return ResultPage{}, err
	}
	page := ResultPage{Items: items}
	if more && len(items) > 0 {
		last := items[len(items)-1]
		page.Next = shared.Some(resultCursor(last))
	}
	return page, nil
}
func resultCursor(r StoredResult) string {
	value := fmt.Sprintf("%s\x00%s\x00%d\x00%s", r.MessageID, r.Result.DecoderID, r.ConfigRevision, r.Result.DecoderVersion)
	sum := sha256.Sum256([]byte(value))
	return "decode_" + hex.EncodeToString(sum[:])
}
