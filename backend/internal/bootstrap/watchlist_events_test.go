package bootstrap

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/application/events"
)

type recordingPublisher struct{ event events.Event }

func (p *recordingPublisher) Publish(event events.Event) bool {
	p.event = event
	return true
}

func TestPublishWatchlistChangesPreservesResponseAndPublishesSuccessfulMutation(t *testing.T) {
	publisher := &recordingPublisher{}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `W/"2"`)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"wr-1"}`))
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/watch-rules", nil)
	publishWatchlistChanges(next, publisher).ServeHTTP(response, request)
	if response.Code != http.StatusCreated || response.Header().Get("ETag") != `W/"2"` || strings.TrimSpace(response.Body.String()) != `{"id":"wr-1"}` {
		t.Fatalf("response status=%d headers=%v body=%q", response.Code, response.Header(), response.Body.String())
	}
	if publisher.event.Type != "watchlist_changed" || publisher.event.OccurredAt.IsZero() || !publisher.event.ScopeActive {
		t.Fatalf("event=%+v", publisher.event)
	}
	data, ok := publisher.event.Data.(map[string]string)
	if !ok || data["watchRuleId"] != "wr-1" || data["action"] != "created" {
		t.Fatalf("event data=%v", publisher.event.Data)
	}
}

func TestPublishWatchlistChangesSkipsFailuresAndReadsPathID(t *testing.T) {
	publisher := &recordingPublisher{}
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "invalid", http.StatusBadRequest) })
	request := httptest.NewRequest(http.MethodPut, "/watch-rules/wr-2", nil)
	request.SetPathValue("ruleId", "wr-2")
	publishWatchlistChanges(next, publisher).ServeHTTP(httptest.NewRecorder(), request)
	if publisher.event.Type != "" {
		t.Fatalf("failed request published event %+v", publisher.event)
	}

	next = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	publishWatchlistChanges(next, publisher).ServeHTTP(httptest.NewRecorder(), request)
	data, ok := publisher.event.Data.(map[string]string)
	if !ok || data["watchRuleId"] != "wr-2" || data["action"] != "updated" || publisher.event.OccurredAt.After(time.Now()) {
		t.Fatalf("event=%+v", publisher.event)
	}
}
