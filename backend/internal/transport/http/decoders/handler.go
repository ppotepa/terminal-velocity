// Package decoders exposes capability, safe-config and non-persisting preview endpoints.
package decoders

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
)

const maxConfigBody = 1 << 17

type MatchRule struct {
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    string `json:"value"`
}
type Config struct {
	Version string      `json:"version"`
	Enabled *bool       `json:"enabled"`
	Rules   []MatchRule `json:"rules"`
}
type Capabilities struct {
	Bearers   []string `json:"bearers"`
	Protocols []string `json:"protocols"`
}
type Field struct {
	Name     string  `json:"name"`
	Type     string  `json:"type"`
	Required bool    `json:"required"`
	Unit     *string `json:"unit"`
}
type Decoder struct {
	ID           string       `json:"id"`
	Version      string       `json:"version"`
	Name         string       `json:"name"`
	Enabled      bool         `json:"enabled"`
	Capabilities Capabilities `json:"capabilities"`
	Fields       []Field      `json:"fields"`
	Rules        []MatchRule  `json:"rules"`
	Revision     int64        `json:"-"`
}
type ResultField struct {
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
	Fields         []ResultField `json:"fields"`
	Reason         string        `json:"reason"`
}
type PreviewRequest struct {
	Payload  *string `json:"payload"`
	Protocol string  `json:"protocol"`
	Bearer   string  `json:"bearer"`
}
type Reader interface {
	ListDecoders(context.Context) ([]Decoder, error)
	UpdateDecoder(context.Context, string, Config, int64) (Decoder, error)
	PreviewDecoder(context.Context, string, PreviewRequest) (DecodeResult, error)
}
type Handler struct{ reader Reader }

func NewHandler(reader Reader) http.Handler {
	h := &Handler{reader: reader}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /decoders", h.list)
	mux.HandleFunc("PUT /decoders/{decoderId}", h.update)
	mux.HandleFunc("POST /decoders/{decoderId}/preview", h.preview)
	return mux
}
func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	items, err := h.reader.ListDecoders(r.Context())
	if err != nil {
		writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "decoder registry is unavailable")
		return
	}
	if items == nil {
		items = []Decoder{}
	}
	writeJSON(w, http.StatusOK, items)
}
func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("decoderId")
	if err := validID(id); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	var input Config
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	if input.Version == "" || input.Enabled == nil || input.Rules == nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", "version, enabled, and rules are required")
		return
	}
	expected, err := expectedRevision(r)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	updated, err := h.reader.UpdateDecoder(r.Context(), id, input, expected)
	if errors.Is(err, ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "decoder not found")
		return
	}
	if errors.Is(err, ErrConflict) {
		writeError(w, r, http.StatusConflict, "conflict", "decoder revision changed")
		return
	}
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		} else {
			writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "decoder configuration storage is unavailable")
		}
		return
	}
	setETag(w, updated.Revision)
	writeJSON(w, http.StatusOK, updated)
}
func (h *Handler) preview(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("decoderId")
	if err := validID(id); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	var input PreviewRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	if input.Payload == nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", "payload is required")
		return
	}
	if len(*input.Payload) > 65536 || len(input.Protocol) > 64 || len(input.Bearer) > 32 {
		writeError(w, r, http.StatusBadRequest, "invalid_input", "preview input exceeds contract limits")
		return
	}
	result, err := h.reader.PreviewDecoder(r.Context(), id, input)
	if errors.Is(err, ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "decoder not found")
		return
	}
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		} else {
			writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "decoder preview is unavailable")
		}
		return
	}
	if result.Fields == nil {
		result.Fields = []ResultField{}
	}
	writeJSON(w, http.StatusOK, result)
}
func validID(id string) error {
	if strings.TrimSpace(id) == "" || len(id) > 128 {
		return errors.New("decoder ID must contain 1-128 characters")
	}
	for _, ch := range id {
		if !(ch >= 'A' && ch <= 'Z' || ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9' || strings.ContainsRune("._:-", ch)) {
			return errors.New("decoder ID contains unsupported characters")
		}
	}
	return nil
}
func expectedRevision(r *http.Request) (int64, error) {
	raw := strings.TrimSpace(r.Header.Get("If-Match"))
	if raw == "" {
		return 0, nil
	}
	raw = strings.TrimPrefix(raw, "W/")
	raw = strings.Trim(raw, "\"")
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || v < 1 {
		return 0, errors.New("If-Match must contain a positive decoder revision")
	}
	return v, nil
}
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxConfigBody)
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
func setETag(w http.ResponseWriter, revision int64) {
	if revision > 0 {
		w.Header().Set("ETag", "W/\""+strconv.FormatInt(revision, 10)+"\"")
	}
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

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
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

var ErrNotFound = errors.New("decoder not found")
var ErrConflict = errors.New("decoder revision conflict")
var ErrInvalidInput = errors.New("invalid decoder configuration or preview")
