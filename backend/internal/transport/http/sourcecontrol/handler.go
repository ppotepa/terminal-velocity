// Package sourcecontrol exposes bounded source health and acquisition budget snapshots.
package sourcecontrol

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

type Budget struct {
	RemainingRequests int       `json:"remainingRequests"`
	ResetsAt          time.Time `json:"resetsAt"`
}
type Health struct {
	ID            string     `json:"id"`
	Status        string     `json:"status"`
	LastSuccessAt *time.Time `json:"lastSuccessAt"`
	LastErrorAt   *time.Time `json:"lastErrorAt"`
	Freshness     string     `json:"freshness"`
	Budget        *Budget    `json:"budget"`
	Enabled       bool       `json:"enabled"`
}
type Provider interface {
	ListSourceHealth(context.Context) ([]Health, error)
}
type Handler struct{ provider Provider }

func NewHandler(provider Provider) http.Handler {
	h := &Handler{provider: provider}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /sources", h.list)
	return mux
}

type apiError struct {
	Error errorDetail `json:"error"`
}
type errorDetail struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"requestId"`
	Details   []any  `json:"details"`
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	items := []Health{}
	if h.provider != nil {
		var err error
		items, err = h.provider.ListSourceHealth(r.Context())
		if err != nil {
			writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "source health is unavailable")
			return
		}
		if items == nil {
			items = []Health{}
		}
		for _, item := range items {
			if err := item.Validate(); err != nil {
				writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "source health is unavailable")
				return
			}
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(items)
}

func (h Health) Validate() error {
	if strings.TrimSpace(h.ID) == "" {
		return errors.New("source health ID is required")
	}
	switch h.Status {
	case "ok", "degraded", "inactive", "not_configured", "blocked", "synthetic", "error":
	default:
		return errors.New("unsupported source status")
	}
	switch h.Freshness {
	case "fresh", "stale", "unknown":
	default:
		return errors.New("unsupported source freshness")
	}
	if h.LastSuccessAt != nil && h.LastSuccessAt.IsZero() || h.LastErrorAt != nil && h.LastErrorAt.IsZero() {
		return errors.New("source timestamps cannot be zero")
	}
	if h.Budget != nil && (h.Budget.RemainingRequests < 0 || h.Budget.ResetsAt.IsZero()) {
		return errors.New("source budget is invalid")
	}
	return nil
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
	_ = json.NewEncoder(w).Encode(apiError{Error: errorDetail{Code: code, Message: message, RequestID: id, Details: []any{}}})
}
