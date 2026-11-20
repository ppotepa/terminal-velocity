// Package sse implements the bounded Server-Sent Events transport.
package sse

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	appevents "github.com/ppotepa/terminal-velocity/backend/internal/application/events"
)

type Subscriber interface {
	Subscribe(string) (<-chan appevents.Envelope, func())
}
type Handler struct {
	subscriber Subscriber
	heartbeat  time.Duration
}

func NewHandler(subscriber Subscriber, heartbeat time.Duration) http.Handler {
	if heartbeat <= 0 {
		heartbeat = 20 * time.Second
	}
	h := &Handler{subscriber: subscriber, heartbeat: heartbeat}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /events", h.serve)
	return mux
}
func (h *Handler) serve(w http.ResponseWriter, r *http.Request) {
	lastID := strings.TrimSpace(r.Header.Get("Last-Event-ID"))
	if len(lastID) > 256 {
		http.Error(w, "Last-Event-ID exceeds 256 characters", http.StatusBadRequest)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming is unavailable", http.StatusServiceUnavailable)
		return
	}
	// Register before sending headers so a publish cannot fall into a gap
	// between the initial flush and subscription.
	stream, cancel := h.subscriber.Subscribe(lastID)
	defer cancel()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()
	ticker := time.NewTicker(h.heartbeat)
	defer ticker.Stop()
	bw := bufio.NewWriter(w)
	for {
		select {
		case <-r.Context().Done():
			return
		case event, open := <-stream:
			if !open {
				return
			}
			if err := writeEvent(bw, event); err != nil {
				return
			}
			if bw.Flush() != nil {
				return
			}
			flusher.Flush()
		case <-ticker.C:
			if _, err := fmt.Fprint(bw, ": keepalive\n\n"); err != nil {
				return
			}
			if bw.Flush() != nil {
				return
			}
			flusher.Flush()
		}
	}
}
func writeEvent(w *bufio.Writer, event appevents.Envelope) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}
	if event.EventID != nil {
		if _, err = fmt.Fprintf(w, "id: %s\n", *event.EventID); err != nil {
			return err
		}
	}
	if _, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, payload); err != nil {
		return err
	}
	return nil
}
