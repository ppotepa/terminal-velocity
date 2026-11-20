// Package watchlist implements WatchRule use cases without depending on storage or HTTP.
package watchlist

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/watch"
)

var (
	ErrNotFound        = errors.New("watch rule not found")
	ErrConflict        = errors.New("watch rule already exists")
	ErrVersionConflict = errors.New("watch rule version conflict")
)

const (
	DefaultPageSize    = 50
	MaxPageSize        = 200
	MaxEnabledPageSize = 1000
)

// StoredRule carries persistence metadata around the validated domain aggregate.
type StoredRule struct {
	Rule      watch.WatchRule
	Version   int64
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Repository is the narrow persistence port required by WatchRule use cases.
type Repository interface {
	Create(context.Context, watch.WatchRule, time.Time) (StoredRule, error)
	Get(context.Context, shared.WatchRuleID) (StoredRule, error)
	Update(context.Context, shared.WatchRuleID, int64, watch.WatchRule, time.Time) (StoredRule, error)
	SetStatus(context.Context, shared.WatchRuleID, int64, watch.Status, time.Time) (StoredRule, error)
	Delete(context.Context, shared.WatchRuleID, int64) error
	List(context.Context, string, int) ([]StoredRule, bool, error)
	ListEnabled(context.Context, string, int) ([]StoredRule, bool, error)
}

// Service owns validation and application-level WatchRule commands.
type Service struct {
	repository Repository
	now        func() time.Time
	newID      func() (shared.WatchRuleID, error)
}

func NewService(repository Repository) *Service {
	return &Service{repository: repository, now: func() time.Time { return time.Now().UTC() }, newID: generateID}
}

// Create validates and persists a new rule at version 1. An omitted ID is generated locally.
func (s *Service) Create(ctx context.Context, rule watch.WatchRule) (StoredRule, error) {
	if rule.ID == "" {
		id, err := s.newID()
		if err != nil {
			return StoredRule{}, fmt.Errorf("generate watch rule id: %w", err)
		}
		rule.ID = id
	}
	validated, err := watch.NewWatchRule(rule)
	if err != nil {
		return StoredRule{}, err
	}
	if validated.Status == watch.StatusDeleted {
		return StoredRule{}, shared.NewDomainError(shared.ErrInvalidInput, "new watch rule cannot be deleted")
	}
	now := s.now().UTC()
	return s.repository.Create(ctx, validated, now)
}

// Get returns one rule and its optimistic-concurrency version.
func (s *Service) Get(ctx context.Context, id shared.WatchRuleID) (StoredRule, error) {
	if err := validateID(id); err != nil {
		return StoredRule{}, err
	}
	return s.repository.Get(ctx, id)
}

// Update replaces rule content only when expectedVersion still matches.
func (s *Service) Update(ctx context.Context, id shared.WatchRuleID, expectedVersion int64, rule watch.WatchRule) (StoredRule, error) {
	if err := validateID(id); err != nil {
		return StoredRule{}, err
	}
	if expectedVersion < 1 {
		return StoredRule{}, shared.NewDomainError(shared.ErrInvalidInput, "expected version must be positive")
	}
	rule.ID = id
	validated, err := watch.NewWatchRule(rule)
	if err != nil {
		return StoredRule{}, err
	}
	if validated.Status == watch.StatusDeleted {
		return StoredRule{}, shared.NewDomainError(shared.ErrInvalidInput, "use remove to delete a watch rule")
	}
	return s.repository.Update(ctx, id, expectedVersion, validated, s.now().UTC())
}

// Enable and Disable persist status changes using compare-and-swap version checks.
func (s *Service) Enable(ctx context.Context, id shared.WatchRuleID, expectedVersion int64) (StoredRule, error) {
	return s.setStatus(ctx, id, expectedVersion, watch.StatusActive)
}

func (s *Service) Disable(ctx context.Context, id shared.WatchRuleID, expectedVersion int64) (StoredRule, error) {
	return s.setStatus(ctx, id, expectedVersion, watch.StatusPaused)
}

func (s *Service) setStatus(ctx context.Context, id shared.WatchRuleID, expectedVersion int64, status watch.Status) (StoredRule, error) {
	if err := validateID(id); err != nil {
		return StoredRule{}, err
	}
	if expectedVersion < 1 {
		return StoredRule{}, shared.NewDomainError(shared.ErrInvalidInput, "expected version must be positive")
	}
	return s.repository.SetStatus(ctx, id, expectedVersion, status, s.now().UTC())
}

// Remove physically removes a rule only when its version has not changed.
func (s *Service) Remove(ctx context.Context, id shared.WatchRuleID, expectedVersion int64) error {
	if err := validateID(id); err != nil {
		return err
	}
	if expectedVersion < 1 {
		return shared.NewDomainError(shared.ErrInvalidInput, "expected version must be positive")
	}
	return s.repository.Delete(ctx, id, expectedVersion)
}

// List returns a stable, bounded page ordered by rule ID.
func (s *Service) List(ctx context.Context, afterID string, limit int) ([]StoredRule, string, error) {
	limit = boundedLimit(limit, DefaultPageSize, MaxPageSize)
	items, more, err := s.repository.List(ctx, afterID, limit)
	if err != nil {
		return nil, "", err
	}
	return items, nextCursor(items, more), nil
}

// ListEnabled returns a bounded, stable page for acquisition schedulers. IDs are
// unique by repository contract; duplicate IDs are discarded defensively.
func (s *Service) ListEnabled(ctx context.Context, afterID string, limit int) ([]StoredRule, string, error) {
	limit = boundedLimit(limit, DefaultPageSize, MaxEnabledPageSize)
	items, more, err := s.repository.ListEnabled(ctx, afterID, limit)
	if err != nil {
		return nil, "", err
	}
	unique := make([]StoredRule, 0, len(items))
	seen := make(map[shared.WatchRuleID]struct{}, len(items))
	for _, item := range items {
		if _, exists := seen[item.Rule.ID]; exists {
			continue
		}
		seen[item.Rule.ID] = struct{}{}
		unique = append(unique, item)
	}
	return unique, nextCursor(unique, more), nil
}

func nextCursor(items []StoredRule, more bool) string {
	if !more || len(items) == 0 {
		return ""
	}
	return string(items[len(items)-1].Rule.ID)
}

func boundedLimit(value, fallback, maximum int) int {
	if value <= 0 {
		return fallback
	}
	if value > maximum {
		return maximum
	}
	return value
}

func validateID(id shared.WatchRuleID) error {
	_, err := shared.NewWatchRuleID(string(id))
	return err
}

func generateID() (shared.WatchRuleID, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return shared.WatchRuleID("wr-" + hex.EncodeToString(bytes[:])), nil
}
