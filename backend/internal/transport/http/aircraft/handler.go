// Package aircraft exposes bounded, source-observed aircraft and flight read endpoints.
package aircraft

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
	DefaultLimit      = 50
	MaxPageSize       = 200
	DefaultTrackLimit = 1000
	MaxTrackLimit     = 5000
)

var ErrNotFound = errors.New("requested aircraft or flight view not found")

type EvidenceValue struct {
	Value              any        `json:"value"`
	Certainty          string     `json:"certainty"`
	Source             *string    `json:"source"`
	ObservedAt         *time.Time `json:"observedAt"`
	UncertaintySeconds *float64   `json:"uncertaintySeconds"`
}
type Position struct {
	Latitude       float64        `json:"latitude"`
	Longitude      float64        `json:"longitude"`
	ObservedAt     time.Time      `json:"observedAt"`
	Source         string         `json:"source"`
	AltitudeMeters *EvidenceValue `json:"altitudeMeters"`
	GroundSpeedMPS *EvidenceValue `json:"groundSpeedMps"`
	HeadingDegrees *EvidenceValue `json:"headingDegrees"`
}
type IdentifierAssertion struct {
	Kind       string     `json:"kind"`
	Value      string     `json:"value"`
	ValidFrom  time.Time  `json:"validFrom"`
	ValidUntil *time.Time `json:"validUntil"`
	Source     string     `json:"source"`
}
type Aircraft struct {
	ID              string                `json:"id"`
	Identifiers     []IdentifierAssertion `json:"identifiers"`
	Callsign        *EvidenceValue        `json:"callsign"`
	CurrentPosition *Position             `json:"currentPosition"`
}
type AircraftPage struct {
	Items      []Aircraft `json:"items"`
	NextCursor *string    `json:"nextCursor"`
}
type BoundaryEvidence struct {
	ObservedAt time.Time `json:"observedAt"`
	Certainty  string    `json:"certainty"`
	Source     string    `json:"source"`
}
type AirportAssertion struct {
	Code   string `json:"code"`
	Source string `json:"source"`
}
type Flight struct {
	ID          string            `json:"id"`
	AircraftID  *string           `json:"aircraftId"`
	Callsign    *EvidenceValue    `json:"callsign"`
	StartedAt   *BoundaryEvidence `json:"startedAt"`
	EndedAt     *BoundaryEvidence `json:"endedAt"`
	Origin      *AirportAssertion `json:"origin"`
	Destination *AirportAssertion `json:"destination"`
}
type FlightPage struct {
	Items      []Flight `json:"items"`
	NextCursor *string  `json:"nextCursor"`
}
type Track struct {
	FlightID  string       `json:"flightId"`
	Segments  [][]Position `json:"segments"`
	Truncated bool         `json:"truncated"`
}
type MapAircraft struct {
	AircraftID       string         `json:"aircraftId"`
	Callsign         *EvidenceValue `json:"callsign"`
	Position         *Position      `json:"position"`
	NoPositionReason *string        `json:"noPositionReason"`
	FlightID         *string        `json:"flightId"`
}
type MapSnapshot struct {
	GeneratedAt     time.Time     `json:"generatedAt"`
	SourceFreshness string        `json:"sourceFreshness"`
	Aircraft        []MapAircraft `json:"aircraft"`
}
type FlightQuery struct {
	Cursor        string
	Limit         int
	AircraftID    shared.Optional[shared.AircraftID]
	StartedAfter  shared.Optional[time.Time]
	StartedBefore shared.Optional[time.Time]
}
type TrackQuery struct {
	From  shared.Optional[time.Time]
	To    shared.Optional[time.Time]
	Limit int
}
type Reader interface {
	MapSnapshot(context.Context) (MapSnapshot, error)
	ListAircraft(context.Context, string, int) (AircraftPage, error)
	GetAircraft(context.Context, shared.AircraftID) (Aircraft, error)
	ListFlights(context.Context, FlightQuery) (FlightPage, error)
	GetFlight(context.Context, shared.FlightID) (Flight, error)
	FlightTrack(context.Context, shared.FlightID, TrackQuery) (Track, error)
}
type Handler struct{ reader Reader }

func NewHandler(reader Reader) http.Handler {
	h := &Handler{reader: reader}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /map/snapshot", h.mapSnapshot)
	mux.HandleFunc("GET /aircraft", h.listAircraft)
	mux.HandleFunc("GET /aircraft/{aircraftId}", h.getAircraft)
	mux.HandleFunc("GET /flights", h.listFlights)
	mux.HandleFunc("GET /flights/{flightId}", h.getFlight)
	mux.HandleFunc("GET /flights/{flightId}/track", h.track)
	return mux
}
func (h *Handler) mapSnapshot(w http.ResponseWriter, r *http.Request) {
	if err := onlyQuery(r.URL.Query()); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	result, err := h.reader.MapSnapshot(r.Context())
	if err != nil {
		writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "aircraft snapshot is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (h *Handler) listAircraft(w http.ResponseWriter, r *http.Request) {
	if err := onlyQuery(r.URL.Query(), "cursor", "limit"); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	cursor := r.URL.Query().Get("cursor")
	if len(cursor) > 256 {
		writeError(w, r, http.StatusBadRequest, "invalid_input", "cursor exceeds 256 characters")
		return
	}
	limit, err := parseLimit(r.URL.Query().Get("limit"), DefaultLimit, MaxPageSize)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	page, err := h.reader.ListAircraft(r.Context(), cursor, limit)
	if err != nil {
		writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "aircraft history is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, page)
}
func (h *Handler) getAircraft(w http.ResponseWriter, r *http.Request) {
	if err := onlyQuery(r.URL.Query()); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	id, err := shared.NewAircraftID(r.PathValue("aircraftId"))
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	item, err := h.reader.GetAircraft(r.Context(), id)
	if errors.Is(err, ErrNotFound) || shared.ErrorIsKind(err, shared.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "aircraft not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "aircraft view is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, item)
}
func (h *Handler) listFlights(w http.ResponseWriter, r *http.Request) {
	if err := onlyQuery(r.URL.Query(), "cursor", "limit", "aircraftId", "startedAfter", "startedBefore"); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	limit, err := parseLimit(r.URL.Query().Get("limit"), DefaultLimit, MaxPageSize)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	q := FlightQuery{Cursor: r.URL.Query().Get("cursor"), Limit: limit}
	if len(q.Cursor) > 256 {
		writeError(w, r, http.StatusBadRequest, "invalid_input", "cursor exceeds 256 characters")
		return
	}
	if len(q.Cursor) > 256 {
		writeError(w, r, http.StatusBadRequest, "invalid_input", "cursor exceeds 256 characters")
		return
	}
	if raw := r.URL.Query().Get("aircraftId"); raw != "" {
		id, e := shared.NewAircraftID(raw)
		if e != nil {
			writeError(w, r, http.StatusBadRequest, "invalid_input", e.Error())
			return
		}
		q.AircraftID = shared.Some(id)
	}
	if raw := r.URL.Query().Get("startedAfter"); raw != "" {
		t, e := time.Parse(time.RFC3339Nano, raw)
		if e != nil {
			writeError(w, r, http.StatusBadRequest, "invalid_input", "startedAfter must be an RFC3339 timestamp")
			return
		}
		q.StartedAfter = shared.Some(t.UTC())
	}
	if raw := r.URL.Query().Get("startedBefore"); raw != "" {
		t, e := time.Parse(time.RFC3339Nano, raw)
		if e != nil {
			writeError(w, r, http.StatusBadRequest, "invalid_input", "startedBefore must be an RFC3339 timestamp")
			return
		}
		q.StartedBefore = shared.Some(t.UTC())
	}
	if q.StartedAfter.Valid && q.StartedBefore.Valid && q.StartedBefore.Value.Before(q.StartedAfter.Value) {
		writeError(w, r, http.StatusBadRequest, "invalid_input", "startedBefore cannot precede startedAfter")
		return
	}
	page, err := h.reader.ListFlights(r.Context(), q)
	if err != nil {
		writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "flight history is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, page)
}
func (h *Handler) getFlight(w http.ResponseWriter, r *http.Request) {
	if err := onlyQuery(r.URL.Query()); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	id, err := shared.NewFlightID(r.PathValue("flightId"))
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	item, err := h.reader.GetFlight(r.Context(), id)
	if errors.Is(err, ErrNotFound) || shared.ErrorIsKind(err, shared.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "flight not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "flight view is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, item)
}
func (h *Handler) track(w http.ResponseWriter, r *http.Request) {
	id, err := shared.NewFlightID(r.PathValue("flightId"))
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	if err := onlyQuery(r.URL.Query(), "from", "to", "limit"); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	q := TrackQuery{Limit: DefaultTrackLimit}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, e := strconv.Atoi(raw)
		if e != nil || n < 1 || n > MaxTrackLimit {
			writeError(w, r, http.StatusBadRequest, "invalid_input", "track limit must be between 1 and 5000")
			return
		}
		q.Limit = n
	}
	if raw := r.URL.Query().Get("from"); raw != "" {
		t, e := time.Parse(time.RFC3339Nano, raw)
		if e != nil {
			writeError(w, r, http.StatusBadRequest, "invalid_input", "from must be an RFC3339 timestamp")
			return
		}
		q.From = shared.Some(t.UTC())
	}
	if raw := r.URL.Query().Get("to"); raw != "" {
		t, e := time.Parse(time.RFC3339Nano, raw)
		if e != nil {
			writeError(w, r, http.StatusBadRequest, "invalid_input", "to must be an RFC3339 timestamp")
			return
		}
		q.To = shared.Some(t.UTC())
	}
	if q.From.Valid && q.To.Valid && q.To.Value.Before(q.From.Value) {
		writeError(w, r, http.StatusBadRequest, "invalid_input", "to cannot precede from")
		return
	}
	item, err := h.reader.FlightTrack(r.Context(), id, q)
	if errors.Is(err, ErrNotFound) || shared.ErrorIsKind(err, shared.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "flight track not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusServiceUnavailable, "dependency_unavailable", "flight track is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, item)
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
	if len(message) > 1024 {
		message = message[:1024]
	}
	requestID := strings.TrimSpace(r.Header.Get("X-Request-ID"))
	if requestID == "" || len(requestID) > 128 {
		var b [12]byte
		if _, err := rand.Read(b[:]); err == nil {
			requestID = "req-" + hex.EncodeToString(b[:])
		} else {
			requestID = "req-unavailable"
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(apiError{Error: apiErrorDetail{Code: code, Message: message, RequestID: requestID, Details: []any{}}})
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func parseLimit(raw string, fallback, maximum int) (int, error) {
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > maximum {
		return 0, errors.New("limit is outside the supported range")
	}
	return n, nil
}
func onlyQuery(values url.Values, allowed ...string) error {
	set := map[string]bool{}
	for _, key := range allowed {
		set[key] = true
	}
	for key := range values {
		if !set[key] {
			return errors.New("unsupported query parameter: " + key)
		}
		if len(values[key]) > 1 {
			return errors.New("query parameter must not be repeated: " + key)
		}
	}
	return nil
}
