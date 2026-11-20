// Package bootstrap composes the process-level HTTP surface from platform dependencies.
package bootstrap

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	transport "github.com/ppotepa/terminal-velocity/backend/internal/transport/http"
)

// Pinger is the small MongoDB dependency needed by readiness.
type Pinger interface {
	Ping(context.Context) error
}

type healthResponse struct {
	Status       string            `json:"status"`
	Version      string            `json:"version"`
	Dependencies map[string]string `json:"dependencies"`
}

// NewHTTPServer builds the local API server around the composed feature handlers.
func NewHTTPServer(address, version string, mongo Pinger, endpoints ...transport.Endpoints) *http.Server {
	health := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		dependency := "ok"
		status := "ok"
		httpStatus := http.StatusOK
		if mongo == nil || mongo.Ping(ctx) != nil {
			dependency = "unavailable"
			status = "degraded"
			httpStatus = http.StatusServiceUnavailable
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(httpStatus)
		_ = json.NewEncoder(w).Encode(healthResponse{
			Status: status, Version: version,
			Dependencies: map[string]string{"mongo": dependency},
		})
	})
	var configured transport.Endpoints
	if len(endpoints) > 0 {
		configured = endpoints[0]
	}
	return &http.Server{
		Addr:              address,
		Handler:           transport.Router(health, configured),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
}
