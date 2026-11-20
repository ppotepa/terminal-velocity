package decoders

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeReader struct {
	previews int
	updated  int
	err      error
}

func (f *fakeReader) ListDecoders(context.Context) ([]Decoder, error) { return []Decoder{}, nil }
func (f *fakeReader) UpdateDecoder(_ context.Context, _ string, c Config, r int64) (Decoder, error) {
	f.updated++
	return Decoder{ID: "d1", Revision: r + 1}, f.err
}
func (f *fakeReader) PreviewDecoder(_ context.Context, _ string, p PreviewRequest) (DecodeResult, error) {
	f.previews++
	return DecodeResult{Status: "decoded"}, f.err
}
func TestUpdateRejectsUnknownFieldsAndPreviewDoesNotUpdate(t *testing.T) {
	f := &fakeReader{}
	h := NewHandler(f)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("PUT", "/decoders/d1", strings.NewReader(`{"version":"1","enabled":true,"rules":[],"extra":true}`)))
	if w.Code != 400 || f.updated != 0 {
		t.Fatalf("status=%d updates=%d", w.Code, f.updated)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/decoders/d1/preview", strings.NewReader(`{"payload":"abc","protocol":"p","bearer":"b"}`)))
	if w.Code != 200 || f.previews != 1 || f.updated != 0 {
		t.Fatalf("status=%d previews=%d updates=%d", w.Code, f.previews, f.updated)
	}
}
func TestDecoderConflictMapsTo409(t *testing.T) {
	f := &fakeReader{err: ErrConflict}
	h := NewHandler(f)
	w := httptest.NewRecorder()
	r := httptest.NewRequest("PUT", "/decoders/d1", strings.NewReader(`{"version":"1","enabled":true,"rules":[]}`))
	r.Header.Set("If-Match", `W/"2"`)
	h.ServeHTTP(w, r)
	if w.Code != 409 {
		t.Fatalf("status=%d", w.Code)
	}
	_ = errors.Is
}
