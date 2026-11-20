package bootstrap

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/application/events"
)

type eventPublisher interface {
	Publish(events.Event) bool
}

// publishWatchlistChanges emits after a successful WatchRule mutation while
// preserving the underlying handler's status, headers, and response body.
func publishWatchlistChanges(next http.Handler, hub eventPublisher) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if hub == nil || (r.Method != http.MethodPost && r.Method != http.MethodPut && r.Method != http.MethodDelete) {
			next.ServeHTTP(w, r)
			return
		}

		captured := httptestResponse()
		next.ServeHTTP(captured, r)
		for key, values := range captured.header {
			for _, value := range values {
				w.Header().Add(key, value)
			}
		}
		status := captured.status
		if status == 0 {
			status = http.StatusOK
		}
		w.WriteHeader(status)
		_, _ = w.Write(captured.body.Bytes())

		action, successful := "", false
		switch r.Method {
		case http.MethodPost:
			action, successful = "created", status == http.StatusCreated
		case http.MethodPut:
			action, successful = "updated", status == http.StatusOK
		case http.MethodDelete:
			action, successful = "deleted", status == http.StatusNoContent
		}
		if !successful {
			return
		}
		id := ""
		if r.Method != http.MethodPost {
			parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
			if len(parts) > 0 {
				id = strings.TrimSpace(parts[len(parts)-1])
			}
		}
		if id == "" {
			var body struct {
				ID string `json:"id"`
			}
			if json.Unmarshal(captured.body.Bytes(), &body) == nil {
				id = body.ID
			}
		}
		if id == "" {
			return
		}
		hub.Publish(events.Event{Type: "watchlist_changed", OccurredAt: time.Now().UTC(), Data: map[string]string{"watchRuleId": id, "action": action}, ScopeActive: true})
	})
}

type capturedResponse struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func httptestResponse() *capturedResponse {
	return &capturedResponse{header: make(http.Header)}
}

func (w *capturedResponse) Header() http.Header { return w.header }
func (w *capturedResponse) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}
func (w *capturedResponse) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.body.Write(body)
}
