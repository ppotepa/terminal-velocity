// Package events provides a bounded in-process event stream for the HTTP transport.
package events

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	DefaultHistory = 512
	DefaultBuffer  = 32
)

type Envelope struct {
	EventID          *string         `json:"eventId"`
	Type             string          `json:"type"`
	OccurredAt       time.Time       `json:"occurredAt"`
	SourceObservedAt *time.Time      `json:"sourceObservedAt"`
	Data             json.RawMessage `json:"data"`
}

// Event is the producer input. ScopeActive must be true after the producer has
// checked that the event belongs to an active, selected scope.
type Event struct {
	Type             string
	OccurredAt       time.Time
	SourceObservedAt *time.Time
	Data             any
	ScopeActive      bool
}

type Hub struct {
	mu           sync.Mutex
	next         uint64
	history      []Envelope
	historyLimit int
	bufferSize   int
	subs         map[uint64]chan Envelope
	nextSub      uint64
}

func NewHub(historyLimit, bufferSize int) *Hub {
	if historyLimit < 1 {
		historyLimit = DefaultHistory
	}
	if bufferSize < 1 {
		bufferSize = DefaultBuffer
	}
	return &Hub{historyLimit: historyLimit, bufferSize: bufferSize, subs: make(map[uint64]chan Envelope)}
}

var allowedTypes = map[string]bool{
	"position_updated": true, "flight_started": true, "flight_ended": true,
	"message_observed": true, "message_decoded": true, "alert_triggered": true,
	"watchlist_changed": true, "source_status_changed": true,
}

// Publish records and broadcasts an event. Out-of-scope events are discarded.
func (h *Hub) Publish(event Event) bool {
	if !event.ScopeActive || !allowedTypes[event.Type] || event.OccurredAt.IsZero() {
		return false
	}
	data, err := json.Marshal(event.Data)
	if err != nil || len(data) == 0 || data[0] != '{' {
		return false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.next++
	id := cursor(h.next)
	e := Envelope{EventID: &id, Type: event.Type, OccurredAt: event.OccurredAt.UTC(), SourceObservedAt: event.SourceObservedAt, Data: data}
	h.history = append(h.history, e)
	if len(h.history) > h.historyLimit {
		h.history = append([]Envelope(nil), h.history[len(h.history)-h.historyLimit:]...)
	}
	for subID, ch := range h.subs {
		select {
		case ch <- e:
		default:
			// A slow client cannot block producers or receive an incomplete tail.
			for len(ch) > 0 {
				<-ch
			}
			ch <- snapshotRequired(time.Now().UTC())
			close(ch)
			delete(h.subs, subID)
		}
	}
	return true
}

// Subscribe replays retained events after lastID. A non-empty stale or invalid
// cursor receives snapshot_required before live delivery. Call cancel once done.
func (h *Hub) Subscribe(lastID string) (<-chan Envelope, func()) {
	h.mu.Lock()
	defer h.mu.Unlock()
	ch := make(chan Envelope, h.bufferSize)
	if lastID != "" {
		seq, valid := parseCursor(lastID)
		oldest := h.next + 1
		if len(h.history) > 0 {
			oldest = sequence(h.history[0])
		}
		if !valid || seq > h.next || seq+1 < oldest {
			ch <- snapshotRequired(time.Now().UTC())
		} else {
			for _, event := range h.history {
				if sequence(event) > seq {
					if len(ch) == cap(ch) {
						for len(ch) > 0 {
							<-ch
						}
						ch <- snapshotRequired(time.Now().UTC())
						break
					}
					ch <- event
				}
			}
		}
	}
	h.nextSub++
	subID := h.nextSub
	h.subs[subID] = ch
	var once sync.Once
	cancel := func() {
		once.Do(func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			if current, ok := h.subs[subID]; ok {
				delete(h.subs, subID)
				close(current)
			}
		})
	}
	return ch, cancel
}

func snapshotRequired(now time.Time) Envelope {
	return Envelope{EventID: nil, Type: "snapshot_required", OccurredAt: now.UTC(), SourceObservedAt: nil,
		Data: json.RawMessage(`{"reason":"cursor_expired","refresh":["/map/snapshot","/flights","/messages","/alert-events"]}`)}
}
func cursor(n uint64) string { return fmt.Sprintf("cursor-%d", n) }
func parseCursor(raw string) (uint64, bool) {
	if !strings.HasPrefix(raw, "cursor-") {
		return 0, false
	}
	n, err := strconv.ParseUint(strings.TrimPrefix(raw, "cursor-"), 10, 64)
	return n, err == nil && n > 0
}
func sequence(e Envelope) uint64 {
	if e.EventID == nil {
		return 0
	}
	n, _ := parseCursor(*e.EventID)
	return n
}
