// Package messages maps bounded message-history reads to the OpenAPI message DTOs.
package messages

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

const (
	DefaultLimit = 50
	MaxPageSize  = 200
)

type EvidenceValue struct {
	Value              any        `json:"value"`
	Certainty          string     `json:"certainty"`
	Source             *string    `json:"source"`
	ObservedAt         *time.Time `json:"observedAt"`
	UncertaintySeconds *float64   `json:"uncertaintySeconds"`
}
type AssociationEvidence struct {
	Kind   string  `json:"kind,omitempty"`
	Value  string  `json:"value,omitempty"`
	Source *string `json:"source,omitempty"`
	Reason string  `json:"reason"`
}
type Association struct {
	Outcome    string                `json:"outcome"`
	AircraftID *string               `json:"aircraftId"`
	FlightID   *string               `json:"flightId"`
	Candidates []string              `json:"candidates"`
	Evidence   []AssociationEvidence `json:"evidence"`
}
type Reception struct {
	ReceiverID  string    `json:"receiverId"`
	FrameBase64 string    `json:"frameBase64"`
	ReceivedAt  time.Time `json:"receivedAt"`
	FrequencyHz *uint64   `json:"frequencyHz"`
}
type DecodeField struct {
	Name  string  `json:"name"`
	Type  string  `json:"type"`
	Value any     `json:"value"`
	Unit  *string `json:"unit"`
}
type DecodeResult struct {
	Status         string        `json:"status"`
	DecoderID      *string       `json:"decoderId"`
	DecoderVersion *string       `json:"decoderVersion"`
	Original       *string       `json:"original"`
	Reason         string        `json:"reason"`
	Fields         []DecodeField `json:"fields"`
}
type Message struct {
	ID                    string                   `json:"id"`
	Source                string                   `json:"source"`
	SourceMessageRef      *string                  `json:"sourceMessageRef"`
	ObservedAt            *time.Time               `json:"observedAt"`
	CollectedAt           time.Time                `json:"collectedAt"`
	Direction             string                   `json:"direction"`
	Bearer                string                   `json:"bearer"`
	Protocol              string                   `json:"protocol"`
	ContentStatus         string                   `json:"contentStatus"`
	OriginalText          *string                  `json:"originalText"`
	Hints                 map[string]EvidenceValue `json:"hints"`
	Association           Association              `json:"association"`
	Reception             *Reception               `json:"reception"`
	DecoderResults        []DecodeResult           `json:"decoderResults"`
	TextPermitted         bool                     `json:"-"`
	DecodeFieldsPermitted bool                     `json:"-"`
}
type Page struct {
	Items      []Message `json:"items"`
	NextCursor *string   `json:"nextCursor"`
}
type Query struct {
	Cursor     string
	Limit      int
	AircraftID shared.Optional[shared.AircraftID]
	FlightID   shared.Optional[shared.FlightID]
	Protocol   string
}
type Reader interface {
	ListMessages(context.Context, Query) (Page, error)
	GetMessage(context.Context, shared.MessageID) (Message, error)
}
type Handler struct{ reader Reader }

func NewHandler(reader Reader) http.Handler {
	h := &Handler{reader: reader}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /messages", h.list)
	mux.HandleFunc("GET /messages/{messageId}", h.get)
	return mux
}
func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	if err := onlyQuery(r.URL.Query(), "cursor", "limit", "aircraftId", "flightId", "protocol"); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	q := Query{Cursor: r.URL.Query().Get("cursor"), Limit: DefaultLimit, Protocol: strings.TrimSpace(r.URL.Query().Get("protocol"))}
	if len(q.Cursor) > 256 {
		writeError(w, r, http.StatusBadRequest, "invalid_input", "cursor exceeds 256 characters")
		return
	}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, e := strconv.Atoi(raw)
		if e != nil || n < 1 || n > MaxPageSize {
			writeError(w, r, http.StatusBadRequest, "invalid_input", "limit must be between 1 and 200")
			return
		}
		q.Limit = n
	}
	if raw := r.URL.Query().Get("aircraftId"); raw != "" {
		id, e := shared.NewAircraftID(raw)
		if e != nil {
			writeError(w, r, http.StatusBadRequest, "invalid_input", e.Error())
			return
		}
		q.AircraftID = shared.Some(id)
	}
	if raw := r.URL.Query().Get("flightId"); raw != "" {
		id, e := shared.NewFlightID(raw)
		if e != nil {
			writeError(w, r, http.StatusBadRequest, "invalid_input", e.Error())
			return
		}
		q.FlightID = shared.Some(id)
	}
	if len(q.Protocol) > 64 {
		writeError(w, r, http.StatusBadRequest, "invalid_input", "protocol exceeds 64 characters")
		return
	}
	page, err := h.reader.ListMessages(r.Context(), q)
	if err != nil {
		writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "message history is unavailable")
		return
	}
	for i := range page.Items {
		page.Items[i] = sanitize(page.Items[i])
	}
	if page.Items == nil {
		page.Items = []Message{}
	}
	writeJSON(w, http.StatusOK, page)
}
func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id, err := shared.NewMessageID(r.PathValue("messageId"))
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	item, err := h.reader.GetMessage(r.Context(), id)
	if errors.Is(err, ErrNotFound) || shared.ErrorIsKind(err, shared.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "message not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "message is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, sanitize(item))
}
func sanitize(item Message) Message {
	if !item.TextPermitted || item.ContentStatus == "unavailable" {
		item.OriginalText = nil
	}
	if !item.DecodeFieldsPermitted || item.ContentStatus == "unavailable" || item.ContentStatus == "encrypted" {
		for i := range item.DecoderResults {
			item.DecoderResults[i].Fields = []DecodeField{}
			item.DecoderResults[i].Original = nil
			if item.DecoderResults[i].Reason == "" {
				item.DecoderResults[i].Reason = "content_not_permitted"
			}
		}
	}
	if item.Hints == nil {
		item.Hints = map[string]EvidenceValue{}
	}
	if item.Association.Candidates == nil {
		item.Association.Candidates = []string{}
	}
	if item.Association.Evidence == nil {
		item.Association.Evidence = []AssociationEvidence{}
	}
	if item.DecoderResults == nil {
		item.DecoderResults = []DecodeResult{}
	}
	return item
}
func onlyQuery(values url.Values, allowed ...string) error {
	set := map[string]bool{}
	for _, k := range allowed {
		set[k] = true
	}
	for k, values := range values {
		if !set[k] {
			return errors.New("unsupported query parameter: " + k)
		}
		if len(values) > 1 {
			return errors.New("query parameter must not be repeated: " + k)
		}
	}
	return nil
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
		if _, e := rand.Read(b[:]); e == nil {
			id = "req-" + hex.EncodeToString(b[:])
		} else {
			id = "req-unavailable"
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(apiError{Error: apiErrorDetail{Code: code, Message: message, RequestID: id, Details: []any{}}})
}

var ErrNotFound = errors.New("message not found")
