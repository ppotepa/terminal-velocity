package watchlist

import (
	"context"
	"errors"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/watch"
)

type memoryRepository struct {
	mu    sync.Mutex
	items map[shared.WatchRuleID]StoredRule
}

func newMemoryRepository() *memoryRepository {
	return &memoryRepository{items: make(map[shared.WatchRuleID]StoredRule)}
}

func (m *memoryRepository) Create(_ context.Context, rule watch.WatchRule, now time.Time) (StoredRule, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.items[rule.ID]; exists {
		return StoredRule{}, ErrConflict
	}
	item := StoredRule{Rule: rule, Version: 1, CreatedAt: now, UpdatedAt: now}
	m.items[rule.ID] = item
	return item, nil
}

func (m *memoryRepository) Get(_ context.Context, id shared.WatchRuleID) (StoredRule, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	item, ok := m.items[id]
	if !ok {
		return StoredRule{}, ErrNotFound
	}
	return item, nil
}

func (m *memoryRepository) Update(_ context.Context, id shared.WatchRuleID, expected int64, rule watch.WatchRule, now time.Time) (StoredRule, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	item, ok := m.items[id]
	if !ok {
		return StoredRule{}, ErrNotFound
	}
	if item.Version != expected {
		return StoredRule{}, ErrVersionConflict
	}
	item.Rule, item.Version, item.UpdatedAt = rule, expected+1, now
	m.items[id] = item
	return item, nil
}

func (m *memoryRepository) SetStatus(_ context.Context, id shared.WatchRuleID, expected int64, status watch.Status, now time.Time) (StoredRule, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	item, ok := m.items[id]
	if !ok {
		return StoredRule{}, ErrNotFound
	}
	if item.Version != expected {
		return StoredRule{}, ErrVersionConflict
	}
	item.Rule.Status, item.Version, item.UpdatedAt = status, expected+1, now
	m.items[id] = item
	return item, nil
}

func (m *memoryRepository) Delete(_ context.Context, id shared.WatchRuleID, expected int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	item, ok := m.items[id]
	if !ok {
		return ErrNotFound
	}
	if item.Version != expected {
		return ErrVersionConflict
	}
	delete(m.items, id)
	return nil
}

func (m *memoryRepository) List(_ context.Context, after string, limit int) ([]StoredRule, bool, error) {
	return m.list(after, limit, false)
}

func (m *memoryRepository) ListEnabled(_ context.Context, after string, limit int) ([]StoredRule, bool, error) {
	return m.list(after, limit, true)
}

func (m *memoryRepository) list(after string, limit int, enabled bool) ([]StoredRule, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	items := make([]StoredRule, 0, len(m.items))
	for _, item := range m.items {
		if string(item.Rule.ID) > after && (!enabled || item.Rule.Status == watch.StatusActive) {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Rule.ID < items[j].Rule.ID })
	more := len(items) > limit
	if more {
		items = items[:limit]
	}
	return items, more, nil
}

func validRule(id string) watch.WatchRule {
	return watch.WatchRule{
		ID: shared.WatchRuleID(id), Name: "Test watch", Status: watch.StatusActive, Scope: watch.ScopeTargeted,
		Groups:     []watch.CriteriaGroup{{Mode: watch.GroupAny, Criteria: []watch.Criterion{{Kind: watch.CriterionICAO24, Value: "A1B2C3"}}}},
		Collection: watch.CollectionPreferences{Positions: true},
	}
}

func TestCreateGeneratesIDAndValidatesBeforePersisting(t *testing.T) {
	repository := newMemoryRepository()
	service := NewService(repository)
	item, err := service.Create(context.Background(), validRule(""))
	if err != nil {
		t.Fatal(err)
	}
	if len(item.Rule.ID) != 35 || item.Version != 1 || item.CreatedAt.IsZero() {
		t.Fatalf("unexpected created record: %+v", item)
	}
	bad := validRule("")
	bad.Collection.Positions = false
	if _, err := service.Create(context.Background(), bad); err == nil {
		t.Fatal("invalid rule was persisted")
	}
}

func TestVersionCheckPreventsConcurrentLostUpdate(t *testing.T) {
	service := NewService(newMemoryRepository())
	created, err := service.Create(context.Background(), validRule("rule-one"))
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := service.Disable(context.Background(), created.Rule.ID, created.Version)
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	succeeded, conflicted := 0, 0
	for err := range results {
		if err == nil {
			succeeded++
		} else if errors.Is(err, ErrVersionConflict) {
			conflicted++
		} else {
			t.Fatalf("unexpected update error: %v", err)
		}
	}
	if succeeded != 1 || conflicted != 1 {
		t.Fatalf("successes=%d conflicts=%d, want one each", succeeded, conflicted)
	}
}

func TestListEnabledIsStableAndBounded(t *testing.T) {
	service := NewService(newMemoryRepository())
	for _, id := range []string{"rule-c", "rule-a", "rule-b"} {
		if _, err := service.Create(context.Background(), validRule(id)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := service.Disable(context.Background(), "rule-b", 1); err != nil {
		t.Fatal(err)
	}
	first, cursor, err := service.ListEnabled(context.Background(), "", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 1 || first[0].Rule.ID != "rule-a" || cursor != "rule-a" {
		t.Fatalf("unexpected first page: items=%v cursor=%q", first, cursor)
	}
	second, next, err := service.ListEnabled(context.Background(), cursor, 5000)
	if err != nil {
		t.Fatal(err)
	}
	if len(second) != 1 || second[0].Rule.ID != "rule-c" || next != "" {
		t.Fatalf("unexpected second page: items=%v cursor=%q", second, next)
	}
}
