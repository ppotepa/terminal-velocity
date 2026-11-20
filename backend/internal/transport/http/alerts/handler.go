// Package alerts exposes bounded alert-rule/event reads, rule settings and acknowledgement.
package alerts

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	MaxPageSize     = 200
	DefaultPageSize = 50
	MaxBodyBytes    = 1 << 20
)

type Rule struct {
	ID              string         `json:"id"`
	Name            string         `json:"name"`
	Enabled         bool           `json:"enabled"`
	Condition       string         `json:"condition"`
	CooldownSeconds int64          `json:"cooldownSeconds"`
	IncludeBackfill bool           `json:"includeBackfill"`
	Parameters      map[string]any `json:"parameters"`
	Revision        int64          `json:"-"`
}
type RuleInput struct {
	Name            *string         `json:"name"`
	Enabled         *bool           `json:"enabled"`
	Condition       *string         `json:"condition"`
	CooldownSeconds *int64          `json:"cooldownSeconds"`
	IncludeBackfill *bool           `json:"includeBackfill"`
	Parameters      *map[string]any `json:"parameters"`
}
type Event struct {
	ID         string    `json:"id"`
	RuleID     string    `json:"ruleId"`
	Condition  string    `json:"condition"`
	AircraftID *string   `json:"aircraftId"`
	FlightID   *string   `json:"flightId"`
	ObservedAt time.Time `json:"observedAt"`
	EmittedAt  time.Time `json:"emittedAt"`
	Backfill   bool      `json:"backfill"`
	Evidence   string    `json:"evidence"`
}
type EventPage struct {
	Items      []Event `json:"items"`
	NextCursor *string `json:"nextCursor"`
}
type Reader interface {
	ListAlertRules(context.Context) ([]Rule, error)
	GetAlertRule(context.Context, string) (Rule, error)
	CreateAlertRule(context.Context, RuleInput) (Rule, error)
	UpdateAlertRule(context.Context, string, RuleInput, int64) (Rule, error)
	DeleteAlertRule(context.Context, string, int64) error
	ListAlertEvents(context.Context, string, int) (EventPage, error)
	AcknowledgeAlertEvent(context.Context, string) error
}
type Handler struct{ reader Reader }

func NewHandler(reader Reader) http.Handler {
	h := &Handler{reader: reader}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /alert-rules", h.listRules)
	mux.HandleFunc("POST /alert-rules", h.createRule)
	mux.HandleFunc("GET /alert-rules/{alertRuleId}", h.getRule)
	mux.HandleFunc("PUT /alert-rules/{alertRuleId}", h.updateRule)
	mux.HandleFunc("DELETE /alert-rules/{alertRuleId}", h.deleteRule)
	mux.HandleFunc("GET /alert-events", h.listEvents)
	mux.HandleFunc("POST /alert-events/{eventId}/acknowledge", h.acknowledge)
	return mux
}
func (h *Handler) listRules(w http.ResponseWriter, r *http.Request) {
	items, err := h.reader.ListAlertRules(r.Context())
	if err != nil {
		writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "alert rules are unavailable")
		return
	}
	if items == nil {
		items = []Rule{}
	}
	writeJSON(w, http.StatusOK, items)
}
func (h *Handler) createRule(w http.ResponseWriter, r *http.Request) {
	var input RuleInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	if err := input.validate(); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	item, err := h.reader.CreateAlertRule(r.Context(), input)
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		} else {
			writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "alert rule storage is unavailable")
		}
		return
	}
	setETag(w, item.Revision)
	writeJSON(w, http.StatusCreated, item)
}
func (h *Handler) getRule(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("alertRuleId")
	if err := validID(id); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	item, err := h.reader.GetAlertRule(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "alert rule not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "alert rule is unavailable")
		return
	}
	setETag(w, item.Revision)
	writeJSON(w, http.StatusOK, item)
}
func (h *Handler) updateRule(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("alertRuleId")
	if err := validID(id); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	var input RuleInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	if err := input.validate(); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	expected, err := expectedVersion(r)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	item, err := h.reader.UpdateAlertRule(r.Context(), id, input, expected)
	if errors.Is(err, ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "alert rule not found")
		return
	}
	if errors.Is(err, ErrConflict) {
		writeError(w, r, http.StatusConflict, "conflict", "alert rule revision changed")
		return
	}
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		} else {
			writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "alert rule storage is unavailable")
		}
		return
	}
	setETag(w, item.Revision)
	writeJSON(w, http.StatusOK, item)
}
func (h *Handler) deleteRule(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("alertRuleId")
	if err := validID(id); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	expected, err := expectedVersion(r)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	if err := h.reader.DeleteAlertRule(r.Context(), id, expected); errors.Is(err, ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "alert rule not found")
		return
	} else if errors.Is(err, ErrConflict) {
		writeError(w, r, http.StatusConflict, "conflict", "alert rule revision changed")
		return
	} else if err != nil {
		writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "alert rule storage is unavailable")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (h *Handler) listEvents(w http.ResponseWriter, r *http.Request) {
	if err := onlyQuery(r, "cursor", "limit"); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	cursor := r.URL.Query().Get("cursor")
	if len(cursor) > 256 {
		writeError(w, r, http.StatusBadRequest, "invalid_input", "cursor exceeds 256 characters")
		return
	}
	limit := DefaultPageSize
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, e := strconv.Atoi(raw)
		if e != nil || n < 1 || n > MaxPageSize {
			writeError(w, r, http.StatusBadRequest, "invalid_input", "limit must be between 1 and 200")
			return
		}
		limit = n
	}
	page, err := h.reader.ListAlertEvents(r.Context(), cursor, limit)
	if err != nil {
		writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "alert events are unavailable")
		return
	}
	if page.Items == nil {
		page.Items = []Event{}
	}
	writeJSON(w, http.StatusOK, page)
}
func (h *Handler) acknowledge(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("eventId")
	decoded, err := hex.DecodeString(id)
	if err != nil || len(decoded) != 32 {
		writeError(w, r, http.StatusBadRequest, "invalid_input", "event ID must be 64 hexadecimal characters")
		return
	}
	if err := h.reader.AcknowledgeAlertEvent(r.Context(), id); errors.Is(err, ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "alert event not found")
		return
	} else if err != nil {
		writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "alert event acknowledgement is unavailable")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (input RuleInput) validate() error {
	if input.Name == nil || input.Enabled == nil || input.Condition == nil || input.CooldownSeconds == nil || input.IncludeBackfill == nil || input.Parameters == nil {
		return errors.New("name, enabled, condition, cooldownSeconds, includeBackfill, and parameters are required")
	}
	if strings.TrimSpace(*input.Name) == "" || len(*input.Name) > 120 {
		return errors.New("name must contain 1-120 characters")
	}
	conditions := map[string]bool{"aircraft_detected": true, "flight_started": true, "flight_ended": true, "country_entered": true, "geofence_entered": true, "threshold": true, "message_observed": true, "message_decoded": true, "feed_error": true}
	if !conditions[*input.Condition] {
		return errors.New("unsupported alert condition")
	}
	if *input.CooldownSeconds < 0 || *input.CooldownSeconds > 31536000 {
		return errors.New("cooldownSeconds must be between 0 and 31536000")
	}
	return nil
}
func validID(id string) error {
	if strings.TrimSpace(id) == "" || len(id) > 128 {
		return errors.New("alert rule ID must contain 1-128 characters")
	}
	for _, ch := range id {
		if !(ch >= 'A' && ch <= 'Z' || ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9' || strings.ContainsRune("._:-", ch)) {
			return errors.New("alert rule ID contains unsupported characters")
		}
	}
	return nil
}
func expectedVersion(r *http.Request) (int64, error) {
	raw := strings.TrimSpace(r.Header.Get("If-Match"))
	if raw == "" {
		return 0, nil
	}
	raw = strings.TrimPrefix(raw, "W/")
	raw = strings.Trim(raw, "\"")
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n < 1 {
		return 0, errors.New("If-Match must contain a positive alert rule revision")
	}
	return n, nil
}
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, MaxBodyBytes)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(dst); err != nil {
		return err
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("request body must contain one JSON value")
		}
		return err
	}
	return nil
}
func onlyQuery(r *http.Request, allowed ...string) error {
	set := map[string]bool{}
	for _, key := range allowed {
		set[key] = true
	}
	for key, values := range r.URL.Query() {
		if !set[key] {
			return errors.New("unsupported query parameter: " + key)
		}
		if len(values) > 1 {
			return errors.New("query parameter must not be repeated: " + key)
		}
	}
	return nil
}
func setETag(w http.ResponseWriter, revision int64) {
	if revision > 0 {
		w.Header().Set("ETag", "W/\""+strconv.FormatInt(revision, 10)+"\"")
	}
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

type apiError struct {
	Error apiErrorDetail `json:"error"`
}
type apiErrorDetail struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"requestId"`
	Details   []any  `json:"details"`
}

func writeError(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	id := strings.TrimSpace(r.Header.Get("X-Request-ID"))
	if id == "" || len(id) > 128 {
		var b [12]byte
		if _, err := rand.Read(b[:]); err == nil {
			id = "req-" + hex.EncodeToString(b[:])
		} else {
			id = "req-unavailable"
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(apiError{Error: apiErrorDetail{Code: code, Message: message, RequestID: id, Details: []any{}}})
}

var ErrNotFound = errors.New("alert rule or event not found")
var ErrConflict = errors.New("alert rule revision conflict")
var ErrInvalidInput = errors.New("invalid alert rule")
