package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRouterMountsIndependentHandlersBelowAPIVersion(t *testing.T) {
	marker := func(value string) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("X-Route", value)
			w.WriteHeader(http.StatusNoContent)
		})
	}
	router := Router(marker("health"), Endpoints{Aircraft: marker("aircraft"), Events: marker("events"), WatchRules: marker("watch")})
	for _, tc := range []struct{ path, want string }{{"/api/health", "health"}, {"/api/v1/map/snapshot", "aircraft"}, {"/api/v1/aircraft/ac-1", "aircraft"}, {"/api/v1/events", "events"}, {"/api/v1/watch-rules/wr-1", "watch"}} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", tc.path, nil))
		if w.Code != 204 || w.Header().Get("X-Route") != tc.want {
			t.Errorf("%s: status=%d route=%q", tc.path, w.Code, w.Header().Get("X-Route"))
		}
	}
}
