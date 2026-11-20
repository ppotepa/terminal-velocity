package watchlist

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	application "github.com/ppotepa/terminal-velocity/backend/internal/application/watchlist"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/watch"
)

type memoryRepository struct {
	items   map[shared.WatchRuleID]application.StoredRule
	creates int
}

func newMemoryRepository() *memoryRepository {
	return &memoryRepository{items: map[shared.WatchRuleID]application.StoredRule{}}
}
func (m *memoryRepository) Create(_ context.Context, r watch.WatchRule, now time.Time) (application.StoredRule, error) {
	m.creates++
	if _, ok := m.items[r.ID]; ok {
		return application.StoredRule{}, application.ErrConflict
	}
	v := application.StoredRule{Rule: r, Version: 1, CreatedAt: now, UpdatedAt: now}
	m.items[r.ID] = v
	return v, nil
}
func (m *memoryRepository) Get(_ context.Context, id shared.WatchRuleID) (application.StoredRule, error) {
	v, ok := m.items[id]
	if !ok {
		return application.StoredRule{}, application.ErrNotFound
	}
	return v, nil
}
func (m *memoryRepository) Update(_ context.Context, id shared.WatchRuleID, expected int64, r watch.WatchRule, now time.Time) (application.StoredRule, error) {
	v, ok := m.items[id]
	if !ok {
		return application.StoredRule{}, application.ErrNotFound
	}
	if v.Version != expected {
		return application.StoredRule{}, application.ErrVersionConflict
	}
	v.Rule = r
	v.Version++
	v.UpdatedAt = now
	m.items[id] = v
	return v, nil
}
func (m *memoryRepository) SetStatus(_ context.Context, id shared.WatchRuleID, expected int64, status watch.Status, now time.Time) (application.StoredRule, error) {
	v, ok := m.items[id]
	if !ok {
		return application.StoredRule{}, application.ErrNotFound
	}
	if v.Version != expected {
		return application.StoredRule{}, application.ErrVersionConflict
	}
	v.Rule.Status = status
	v.Version++
	v.UpdatedAt = now
	m.items[id] = v
	return v, nil
}
func (m *memoryRepository) Delete(_ context.Context, id shared.WatchRuleID, expected int64) error {
	v, ok := m.items[id]
	if !ok {
		return application.ErrNotFound
	}
	if v.Version != expected {
		return application.ErrVersionConflict
	}
	delete(m.items, id)
	return nil
}
func (m *memoryRepository) List(_ context.Context, after string, limit int) ([]application.StoredRule, bool, error) {
	out := []application.StoredRule{}
	for id, v := range m.items {
		if string(id) > after {
			out = append(out, v)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Rule.ID < out[j].Rule.ID })
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	return out, more, nil
}
func (m *memoryRepository) ListEnabled(ctx context.Context, after string, limit int) ([]application.StoredRule, bool, error) {
	items, more, err := m.List(ctx, after, limit)
	out := items[:0]
	for _, item := range items {
		if item.Rule.Status == watch.StatusActive {
			out = append(out, item)
		}
	}
	return out, more, err
}

type rejectingValidator struct{ calls int }

func (v *rejectingValidator) Validate(context.Context, watch.WatchRule) ([]ValidationIssue, error) {
	v.calls++
	return []ValidationIssue{{Code: "no_capable_source", Message: "no source supports this lookup", SourceID: "fixture"}}, nil
}

const validBody = `{"name":"Synthetic watch","status":"active","scope":"targeted","groups":[{"mode":"any","criteria":[{"kind":"icao24","value":"a1b2c3"}]}],"collection":{"positions":true,"messages":false,"decoderIds":[]}}`

func request(handler http.Handler, method, path, body, etag string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if etag != "" {
		r.Header.Set("If-Match", etag)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func TestWatchRuleRESTCRUDAndETagVersioning(t *testing.T) {
	repo := newMemoryRepository()
	handler := NewHandler(application.NewService(repo), nil)
	created := request(handler, http.MethodPost, "/watch-rules", validBody, "")
	if created.Code != http.StatusCreated || created.Header().Get("ETag") != "W/\"1\"" {
		t.Fatalf("create status=%d headers=%v body=%s", created.Code, created.Header(), created.Body)
	}
	var item struct {
		ID     string `json:"id"`
		Groups []struct {
			Criteria []struct {
				Value string `json:"value"`
			} `json:"criteria"`
		} `json:"groups"`
		Collection struct {
			DecoderIDs []string `json:"decoderIds"`
		} `json:"collection"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	if item.ID == "" || item.Groups[0].Criteria[0].Value != "A1B2C3" || item.Collection.DecoderIDs == nil {
		t.Fatalf("response=%+v", item)
	}
	got := request(handler, http.MethodGet, "/watch-rules/"+item.ID, "", "")
	if got.Code != http.StatusOK || got.Header().Get("ETag") != "W/\"1\"" {
		t.Fatalf("get status=%d body=%s", got.Code, got.Body)
	}
	paused := strings.Replace(validBody, `"status":"active"`, `"status":"paused"`, 1)
	updated := request(handler, http.MethodPut, "/watch-rules/"+item.ID, paused, `W/"1"`)
	if updated.Code != http.StatusOK || updated.Header().Get("ETag") != `W/"2"` {
		t.Fatalf("update status=%d body=%s", updated.Code, updated.Body)
	}
	active := request(handler, http.MethodPut, "/watch-rules/"+item.ID, validBody, `W/"2"`)
	if active.Code != http.StatusOK || !strings.Contains(active.Body.String(), `"status":"active"`) {
		t.Fatalf("enable status=%d body=%s", active.Code, active.Body)
	}
	stale := request(handler, http.MethodPut, "/watch-rules/"+item.ID, validBody, `W/"1"`)
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale status=%d body=%s", stale.Code, stale.Body)
	}
	deleted := request(handler, http.MethodDelete, "/watch-rules/"+item.ID, "", `W/"3"`)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete status=%d body=%s", deleted.Code, deleted.Body)
	}
}

func TestMalformedOrUnsupportedRulesFailBeforePersistence(t *testing.T) {
	repo := newMemoryRepository()
	validator := &rejectingValidator{}
	handler := NewHandler(application.NewService(repo), validator)
	malformed := strings.Replace(validBody, "a1b2c3", "bad identifier", 1)
	bad := request(handler, http.MethodPost, "/watch-rules", malformed, "")
	if bad.Code != http.StatusBadRequest || repo.creates != 0 || validator.calls != 0 {
		t.Fatalf("bad status=%d creates=%d validations=%d body=%s", bad.Code, repo.creates, validator.calls, bad.Body)
	}
	unsupported := request(handler, http.MethodPost, "/watch-rules", validBody, "")
	if unsupported.Code != http.StatusBadRequest || repo.creates != 0 || validator.calls != 1 {
		t.Fatalf("unsupported status=%d creates=%d validations=%d body=%s", unsupported.Code, repo.creates, validator.calls, unsupported.Body)
	}
	var response struct {
		Error struct {
			Code, RequestID string
			Details         []struct{ Field, Reason string }
		} `json:"error"`
	}
	if err := json.Unmarshal(unsupported.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Error.Code != "invalid_input" || response.Error.RequestID == "" || len(response.Error.Details) != 1 {
		t.Fatalf("structured error=%+v", response)
	}
}

func TestWatchRuleBodyAndPaginationBounds(t *testing.T) {
	repo := newMemoryRepository()
	handler := NewHandler(application.NewService(repo), nil)
	unknown := request(handler, http.MethodPost, "/watch-rules", strings.TrimSuffix(validBody, "}")+`,"unexpected":true}`, "")
	if unknown.Code != http.StatusBadRequest || repo.creates != 0 {
		t.Fatalf("unknown property status=%d creates=%d", unknown.Code, repo.creates)
	}
	missing := request(handler, http.MethodPost, "/watch-rules", `{"name":"missing"}`, "")
	if missing.Code != http.StatusBadRequest || repo.creates != 0 {
		t.Fatalf("missing required status=%d creates=%d", missing.Code, repo.creates)
	}
	missingDecoderIDs := strings.Replace(validBody, `,"decoderIds":[]`, "", 1)
	if response := request(handler, http.MethodPost, "/watch-rules", missingDecoderIDs, ""); response.Code != http.StatusBadRequest || repo.creates != 0 {
		t.Fatalf("missing decoderIds status=%d creates=%d body=%s", response.Code, repo.creates, response.Body)
	}
	page := request(handler, http.MethodGet, "/watch-rules?limit=201", "", "")
	if page.Code != http.StatusBadRequest {
		t.Fatalf("limit status=%d", page.Code)
	}
}

func TestRepositoryFailureMapsToStructuredUnavailable(t *testing.T) {
	repo := newMemoryRepository()
	repo.items["rule1"] = application.StoredRule{}
	handler := NewHandler(application.NewService(failingRepository{memoryRepository: repo}), nil)
	response := request(handler, http.MethodGet, "/watch-rules/rule1", "", "")
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", response.Code, response.Body)
	}
}

type failingRepository struct{ *memoryRepository }

func (r failingRepository) Get(context.Context, shared.WatchRuleID) (application.StoredRule, error) {
	return application.StoredRule{}, errors.New("storage details should not leak")
}
