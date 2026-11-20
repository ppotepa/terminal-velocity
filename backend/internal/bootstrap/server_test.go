package bootstrap

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakePinger struct{ err error }

func (p fakePinger) Ping(context.Context) error { return p.err }

func TestHealthReportsMongoReadiness(t *testing.T) {
	for _, test := range []struct {
		name       string
		pingErr    error
		wantStatus int
		wantState  string
	}{
		{name: "ready", wantStatus: http.StatusOK, wantState: "ok"},
		{name: "mongo unavailable", pingErr: errors.New("offline"), wantStatus: http.StatusServiceUnavailable, wantState: "unavailable"},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
			NewHTTPServer("127.0.0.1:8080", "1.0.0", fakePinger{err: test.pingErr}).Handler.ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
			var body struct {
				Status       string            `json:"status"`
				Version      string            `json:"version"`
				Dependencies map[string]string `json:"dependencies"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Dependencies["mongo"] != test.wantState {
				t.Fatalf("mongo state = %q, want %q", body.Dependencies["mongo"], test.wantState)
			}
		})
	}
}

func TestHealthOnlyAllowsGet(t *testing.T) {
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/health", nil)
	NewHTTPServer("127.0.0.1:8080", "1.0.0", fakePinger{}).Handler.ServeHTTP(response, request)
	if response.Code != http.StatusMethodNotAllowed || response.Header().Get("Allow") != http.MethodGet {
		t.Fatalf("unexpected method response: status=%d allow=%q", response.Code, response.Header().Get("Allow"))
	}
}
