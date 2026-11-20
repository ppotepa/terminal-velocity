// Package watchlist maps WatchRule REST requests onto application use cases.
package watchlist

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	application "github.com/ppotepa/terminal-velocity/backend/internal/application/watchlist"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/watch"
)

const maxJSONBody = 1 << 20

type ValidationIssue struct {
	Code     string `json:"code"`
	Message  string `json:"message"`
	SourceID string `json:"sourceId,omitempty"`
}
type RuleValidator interface {
	Validate(context.Context, watch.WatchRule) ([]ValidationIssue, error)
}
type Handler struct {
	service   *application.Service
	validator RuleValidator
}

func NewHandler(service *application.Service, validator RuleValidator) http.Handler {
	h := &Handler{service: service, validator: validator}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /watch-rules", h.list)
	mux.HandleFunc("POST /watch-rules", h.create)
	mux.HandleFunc("GET /watch-rules/{ruleId}", h.get)
	mux.HandleFunc("PUT /watch-rules/{ruleId}", h.update)
	mux.HandleFunc("DELETE /watch-rules/{ruleId}", h.delete)
	return mux
}

type requestDTO struct {
	Name       string         `json:"name"`
	Status     *watch.Status  `json:"status"`
	Scope      *watch.Scope   `json:"scope"`
	Groups     *[]groupDTO    `json:"groups"`
	Window     *windowDTO     `json:"window"`
	Discovery  *discoveryDTO  `json:"discovery"`
	Collection *collectionDTO `json:"collection"`
}
type groupDTO struct {
	Mode     watch.GroupMode `json:"mode"`
	Criteria []criterionDTO  `json:"criteria"`
}
type criterionDTO struct {
	Kind  watch.CriterionKind `json:"kind"`
	Value string              `json:"value"`
}
type windowDTO struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}
type discoveryDTO struct {
	AreaID        string `json:"areaId"`
	MaxCandidates int    `json:"maxCandidates"`
}
type collectionDTO struct {
	Positions  bool      `json:"positions"`
	Messages   bool      `json:"messages"`
	DecoderIDs *[]string `json:"decoderIds"`
}
type ruleDTO struct {
	ID         shared.WatchRuleID `json:"id"`
	Name       string             `json:"name"`
	Status     watch.Status       `json:"status"`
	Scope      watch.Scope        `json:"scope"`
	Groups     []groupDTO         `json:"groups"`
	Window     *windowDTO         `json:"window,omitempty"`
	Discovery  *discoveryDTO      `json:"discovery,omitempty"`
	Collection collectionDTO      `json:"collection"`
	CreatedAt  time.Time          `json:"createdAt"`
	UpdatedAt  time.Time          `json:"updatedAt"`
}
type rulePageDTO struct {
	Items      []ruleDTO `json:"items"`
	NextCursor *string   `json:"nextCursor"`
}
type apiErrorDTO struct {
	Error errorDetailDTO `json:"error"`
}
type errorDetailDTO struct {
	Code      string          `json:"code"`
	Message   string          `json:"message"`
	RequestID string          `json:"requestId"`
	Details   []errorFieldDTO `json:"details"`
}
type errorFieldDTO struct {
	Field  string `json:"field"`
	Reason string `json:"reason"`
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	limit, err := parseLimit(r.URL.Query().Get("limit"))
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error(), nil)
		return
	}
	cursor := r.URL.Query().Get("cursor")
	if len(cursor) > 256 {
		writeError(w, r, http.StatusBadRequest, "invalid_input", "cursor exceeds 256 characters", nil)
		return
	}
	items, next, err := h.service.List(r.Context(), cursor, limit)
	if err != nil {
		writeAppError(w, r, err)
		return
	}
	out := rulePageDTO{Items: make([]ruleDTO, 0, len(items))}
	for _, item := range items {
		out.Items = append(out.Items, toDTO(item))
	}
	if next != "" {
		out.NextCursor = &next
	}
	writeJSON(w, http.StatusOK, out)
}
func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var body requestDTO
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error(), nil)
		return
	}
	if err := body.validateRequired(); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error(), nil)
		return
	}
	rule := body.toDomain("")
	rule.ID = "validation-rule"
	validated, err := watch.NewWatchRule(rule)
	if err != nil {
		writeAppError(w, r, err)
		return
	}
	if issues, err := h.validate(r.Context(), validated); err != nil {
		writeAppError(w, r, err)
		return
	} else if len(issues) > 0 {
		writeValidationError(w, r, issues)
		return
	}
	validated.ID = ""
	item, err := h.service.Create(r.Context(), validated)
	if err != nil {
		writeAppError(w, r, err)
		return
	}
	setETag(w, item.Version)
	w.Header().Set("Location", "/watch-rules/"+string(item.Rule.ID))
	writeJSON(w, http.StatusCreated, toDTO(item))
}
func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id := shared.WatchRuleID(r.PathValue("ruleId"))
	item, err := h.service.Get(r.Context(), id)
	if err != nil {
		writeAppError(w, r, err)
		return
	}
	setETag(w, item.Version)
	writeJSON(w, http.StatusOK, toDTO(item))
}
func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	id := shared.WatchRuleID(r.PathValue("ruleId"))
	var body requestDTO
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error(), nil)
		return
	}
	if err := body.validateRequired(); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error(), nil)
		return
	}
	rule := body.toDomain(id)
	validated, err := watch.NewWatchRule(rule)
	if err != nil {
		writeAppError(w, r, err)
		return
	}
	if issues, err := h.validate(r.Context(), validated); err != nil {
		writeAppError(w, r, err)
		return
	} else if len(issues) > 0 {
		writeValidationError(w, r, issues)
		return
	}
	expected, err := h.expectedVersion(r, id)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error(), nil)
		return
	}
	item, err := h.service.Update(r.Context(), id, expected, validated)
	if err != nil {
		writeAppError(w, r, err)
		return
	}
	setETag(w, item.Version)
	writeJSON(w, http.StatusOK, toDTO(item))
}
func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	id := shared.WatchRuleID(r.PathValue("ruleId"))
	expected, err := h.expectedVersion(r, id)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error(), nil)
		return
	}
	if err := h.service.Remove(r.Context(), id, expected); err != nil {
		writeAppError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (h *Handler) expectedVersion(r *http.Request, id shared.WatchRuleID) (int64, error) {
	header := strings.TrimSpace(r.Header.Get("If-Match"))
	if header != "" {
		header = strings.TrimPrefix(header, "W/")
		header = strings.Trim(header, "\"")
		version, err := strconv.ParseInt(header, 10, 64)
		if err != nil || version < 1 {
			return 0, errors.New("If-Match must contain a positive WatchRule version")
		}
		return version, nil
	}
	current, err := h.service.Get(r.Context(), id)
	if err != nil {
		return 0, err
	}
	return current.Version, nil
}
func (h *Handler) validate(ctx context.Context, rule watch.WatchRule) ([]ValidationIssue, error) {
	if h.validator == nil {
		return nil, nil
	}
	return h.validator.Validate(ctx, rule)
}

func (b requestDTO) validateRequired() error {
	if b.Status == nil || b.Scope == nil || b.Groups == nil || b.Collection == nil {
		return errors.New("name, status, scope, groups, and collection are required")
	}
	if b.Collection.DecoderIDs == nil {
		return errors.New("collection.decoderIds is required")
	}
	return nil
}
func (b requestDTO) toDomain(id shared.WatchRuleID) watch.WatchRule {
	groups := make([]watch.CriteriaGroup, 0, len(*b.Groups))
	for _, g := range *b.Groups {
		criteria := make([]watch.Criterion, 0, len(g.Criteria))
		for _, c := range g.Criteria {
			criteria = append(criteria, watch.Criterion{Kind: c.Kind, Value: c.Value})
		}
		groups = append(groups, watch.CriteriaGroup{Mode: g.Mode, Criteria: criteria})
	}
	var window *watch.Window
	if b.Window != nil {
		window = &watch.Window{Start: b.Window.Start, End: b.Window.End}
	}
	var discovery *watch.DiscoveryBounds
	if b.Discovery != nil {
		discovery = &watch.DiscoveryBounds{AreaID: b.Discovery.AreaID, MaxCandidates: b.Discovery.MaxCandidates}
	}
	return watch.WatchRule{ID: id, Name: b.Name, Status: *b.Status, Scope: *b.Scope, Groups: groups, Window: window, Discovery: discovery, Collection: watch.CollectionPreferences{Positions: b.Collection.Positions, Messages: b.Collection.Messages, DecoderIDs: append([]string(nil), (*b.Collection.DecoderIDs)...)}}
}
func toDTO(item application.StoredRule) ruleDTO {
	rule := item.Rule
	groups := make([]groupDTO, 0, len(rule.Groups))
	for _, g := range rule.Groups {
		criteria := make([]criterionDTO, 0, len(g.Criteria))
		for _, c := range g.Criteria {
			criteria = append(criteria, criterionDTO{Kind: c.Kind, Value: c.Value})
		}
		groups = append(groups, groupDTO{Mode: g.Mode, Criteria: criteria})
	}
	var window *windowDTO
	if rule.Window != nil {
		window = &windowDTO{Start: rule.Window.Start, End: rule.Window.End}
	}
	var discovery *discoveryDTO
	if rule.Discovery != nil {
		discovery = &discoveryDTO{AreaID: rule.Discovery.AreaID, MaxCandidates: rule.Discovery.MaxCandidates}
	}
	decoderIDs := append([]string{}, rule.Collection.DecoderIDs...)
	return ruleDTO{ID: rule.ID, Name: rule.Name, Status: rule.Status, Scope: rule.Scope, Groups: groups, Window: window, Discovery: discovery, Collection: collectionDTO{Positions: rule.Collection.Positions, Messages: rule.Collection.Messages, DecoderIDs: &decoderIDs}, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}
func parseLimit(value string) (int, error) {
	if value == "" {
		return application.DefaultPageSize, nil
	}
	limit, err := strconv.Atoi(value)
	if err != nil || limit < 1 || limit > application.MaxPageSize {
		return 0, errors.New("limit must be between 1 and 200")
	}
	return limit, nil
}
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return errors.New("request body must contain exactly one JSON value")
		}
		return err
	}
	return nil
}
func writeAppError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, application.ErrNotFound):
		writeError(w, r, http.StatusNotFound, "not_found", "watch rule not found", nil)
	case errors.Is(err, application.ErrConflict), errors.Is(err, application.ErrVersionConflict), shared.ErrorIsKind(err, shared.ErrConflict):
		writeError(w, r, http.StatusConflict, "conflict", err.Error(), nil)
	case shared.ErrorIsKind(err, shared.ErrInvalidInput), shared.ErrorIsKind(err, shared.ErrOutOfRange):
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error(), nil)
	default:
		writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "watch rule storage is unavailable", nil)
	}
}
func writeValidationError(w http.ResponseWriter, r *http.Request, issues []ValidationIssue) {
	details := make([]errorFieldDTO, 0, len(issues))
	for _, issue := range issues {
		field := issue.Code
		if issue.SourceID != "" {
			field += " (" + issue.SourceID + ")"
		}
		details = append(details, errorFieldDTO{Field: field, Reason: issue.Message})
	}
	writeError(w, r, http.StatusBadRequest, "invalid_input", "watch rule cannot be planned safely", details)
}
func writeError(w http.ResponseWriter, r *http.Request, status int, code, message string, details []errorFieldDTO) {
	if len(message) > 1024 {
		message = message[:1024]
	}
	if details == nil {
		details = []errorFieldDTO{}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(apiErrorDTO{Error: errorDetailDTO{Code: code, Message: message, RequestID: requestID(r), Details: details}})
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func requestID(r *http.Request) string {
	if id := strings.TrimSpace(r.Header.Get("X-Request-ID")); id != "" && len(id) <= 128 {
		return id
	}
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "req-unavailable"
	}
	return "req-" + hex.EncodeToString(b[:])
}
func setETag(w http.ResponseWriter, version int64) {
	w.Header().Set("ETag", fmt.Sprintf("W/\"%d\"", version))
}
