package sse

import (
	"github.com/ppotepa/terminal-velocity/backend/internal/application/events"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakeSubscriber struct{ last string }

func (f *fakeSubscriber) Subscribe(id string) (<-chan events.Envelope, func()) {
	f.last = id
	ch := make(chan events.Envelope, 1)
	id2 := "cursor-5"
	ch <- events.Envelope{EventID: &id2, Type: "position_updated", OccurredAt: time.Unix(1, 0).UTC(), Data: []byte(`{"aircraftId":"ac-1"}`)}
	close(ch)
	return ch, func() {}
}
func TestSSEWritesEnvelopeAndRejectsOversizedCursor(t *testing.T) {
	f := &fakeSubscriber{}
	h := NewHandler(f, time.Second)
	r := httptest.NewRequest("GET", "/events", nil)
	r.Header.Set("Last-Event-ID", "cursor-4")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || w.Header().Get("Content-Type") != "text/event-stream" || f.last != "cursor-4" {
		t.Fatalf("status=%d headers=%v cursor=%s", w.Code, w.Header(), f.last)
	}
	if !strings.Contains(w.Body.String(), "id: cursor-5\nevent: position_updated\ndata: ") {
		t.Fatalf("body=%q", w.Body.String())
	}
	r = httptest.NewRequest("GET", "/events", nil)
	r.Header.Set("Last-Event-ID", strings.Repeat("x", 257))
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 400 {
		t.Fatalf("oversized cursor status=%d", w.Code)
	}
}
