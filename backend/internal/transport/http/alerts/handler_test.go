package alerts

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeReader struct {
	ack       string
	ackErr    error
	listLimit int
}

func (*fakeReader) ListAlertRules(context.Context) ([]Rule, error)     { return []Rule{}, nil }
func (*fakeReader) GetAlertRule(context.Context, string) (Rule, error) { return Rule{}, ErrNotFound }
func (*fakeReader) CreateAlertRule(context.Context, RuleInput) (Rule, error) {
	return Rule{ID: "r1", Revision: 2}, nil
}
func (*fakeReader) UpdateAlertRule(context.Context, string, RuleInput, int64) (Rule, error) {
	return Rule{}, ErrConflict
}
func (*fakeReader) DeleteAlertRule(context.Context, string, int64) error { return nil }
func (f *fakeReader) ListAlertEvents(_ context.Context, _ string, n int) (EventPage, error) {
	f.listLimit = n
	return EventPage{}, nil
}
func (f *fakeReader) AcknowledgeAlertEvent(_ context.Context, id string) error {
	f.ack = id
	return f.ackErr
}
func TestAlertRuleStrictInputAndEventAcknowledgement(t *testing.T) {
	f := &fakeReader{}
	h := NewHandler(f)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/alert-rules", strings.NewReader(`{"name":"x","enabled":true,"condition":"aircraft_detected","cooldownSeconds":10,"includeBackfill":false,"parameters":{},"extra":1}`)))
	if w.Code != 400 {
		t.Fatalf("unknown field status=%d", w.Code)
	}
	id := strings.Repeat("a", 64)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/alert-events/"+id+"/acknowledge", nil))
	if w.Code != 204 || f.ack != id {
		t.Fatalf("ack status=%d id=%q", w.Code, f.ack)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/alert-events?limit=7", nil))
	if w.Code != 200 || f.listLimit != 7 {
		t.Fatalf("list status=%d limit=%d", w.Code, f.listLimit)
	}
	f.ackErr = errors.New("storage")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/alert-events/"+id+"/acknowledge", nil))
	if w.Code != 503 {
		t.Fatalf("dependency status=%d", w.Code)
	}
}
