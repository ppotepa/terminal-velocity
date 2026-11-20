package events

import (
	"encoding/json"
	"testing"
	"time"
)

func event(n int) Event {
	return Event{Type: "position_updated", OccurredAt: time.Unix(int64(n), 0), Data: map[string]any{"aircraftId": "ac-1"}, ScopeActive: true}
}
func TestHubPublishesOnlyScopedEventsAndReplaysRetainedHistory(t *testing.T) {
	h := NewHub(2, 4)
	if h.Publish(Event{Type: "position_updated", OccurredAt: time.Now(), Data: map[string]string{}, ScopeActive: false}) {
		t.Fatal("published inactive scope")
	}
	h.Publish(event(1))
	h.Publish(event(2))
	h.Publish(event(3))
	ch, cancel := h.Subscribe("cursor-1")
	defer cancel()
	got := <-ch
	if got.Type != "position_updated" || *got.EventID != "cursor-2" {
		t.Fatalf("replay=%+v", got)
	}
	data := map[string]any{}
	if err := json.Unmarshal(got.Data, &data); err != nil || data["aircraftId"] != "ac-1" {
		t.Fatalf("data=%s err=%v", got.Data, err)
	}
}
func TestHubRequestsSnapshotForExpiredCursorAndSlowSubscriber(t *testing.T) {
	h := NewHub(1, 1)
	h.Publish(event(1))
	h.Publish(event(2))
	h.Publish(event(3))
	ch, cancel := h.Subscribe("cursor-1")
	defer cancel()
	if got := <-ch; got.Type != "snapshot_required" {
		t.Fatalf("stale cursor event=%+v", got)
	}
	slow, cancelSlow := h.Subscribe("")
	defer cancelSlow()
	h.Publish(event(4))
	h.Publish(event(5))
	got, ok := <-slow
	if !ok || got.Type != "snapshot_required" || got.EventID != nil {
		t.Fatalf("overflow event=%+v open=%v", got, ok)
	}
}

func TestHubPublishesWatchlistChangeForScopedClients(t *testing.T) {
	h := NewHub(4, 2)
	ch, cancel := h.Subscribe("")
	defer cancel()
	if !h.Publish(Event{Type: "watchlist_changed", OccurredAt: time.Unix(10, 0), Data: map[string]any{"watchRuleId": "wr-1", "action": "updated"}, ScopeActive: true}) {
		t.Fatal("watchlist change was rejected")
	}
	got := <-ch
	if got.Type != "watchlist_changed" || got.EventID == nil {
		t.Fatalf("watchlist event=%+v", got)
	}
	if h.Publish(Event{Type: "watchlist_changed", OccurredAt: time.Unix(11, 0), Data: map[string]any{"watchRuleId": "wr-1"}, ScopeActive: false}) {
		t.Fatal("unscoped watchlist change was published")
	}
}
