package messages

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

type fakeReader struct {
	item  Message
	err   error
	query Query
}

func (f *fakeReader) ListMessages(_ context.Context, q Query) (Page, error) {
	f.query = q
	return Page{Items: []Message{f.item}}, f.err
}
func (f *fakeReader) GetMessage(context.Context, shared.MessageID) (Message, error) {
	return f.item, f.err
}

func TestMessageReadsHideUnpermittedContentAndRejectUnknownFilters(t *testing.T) {
	text := "private payload"
	reader := &fakeReader{item: Message{ContentStatus: "available", OriginalText: &text, DecoderResults: []DecodeResult{{Original: &text, Fields: []DecodeField{{Name: "secret"}}}}}}
	h := NewHandler(reader)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/messages?limit=10", nil))
	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), text) || strings.Contains(w.Body.String(), "secret") {
		t.Fatalf("private content leaked: %s", w.Body)
	}
	if reader.query.Limit != 10 {
		t.Fatalf("limit=%d", reader.query.Limit)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/messages?surprise=1", nil))
	if w.Code != 400 {
		t.Fatalf("unknown parameter status=%d", w.Code)
	}
}
func TestMessageReadMapsMissingAndDependencyErrors(t *testing.T) {
	reader := &fakeReader{err: ErrNotFound}
	h := NewHandler(reader)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/messages/msg-1", nil))
	if w.Code != 404 {
		t.Fatalf("missing status=%d", w.Code)
	}
	reader.err = errors.New("storage down")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/messages/msg-1", nil))
	if w.Code != 503 {
		t.Fatalf("dependency status=%d", w.Code)
	}
}
