package crawler

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

type fixtureRenderer struct {
	calls   int
	urls    []string
	page    string
	started chan struct{}
	block   bool
}

func (r *fixtureRenderer) Render(ctx context.Context, pageURL, selector string, maxBytes int) (string, error) {
	r.calls++
	r.urls = append(r.urls, pageURL)
	if r.started != nil {
		close(r.started)
	}
	if r.block {
		<-ctx.Done()
		return "", ctx.Err()
	}
	if selector == "" || len(r.page) > maxBytes {
		return "", ErrPageTooLarge
	}
	return r.page, nil
}

func TestCrawlPropagatesCallerCancellationToRenderer(t *testing.T) {
	renderer := &fixtureRenderer{page: fixtureHTML(t), started: make(chan struct{}), block: true}
	cfg := DefaultConfig()
	cfg.LiveEnabled = true
	cfg.PermissionConfirmed = true
	cfg.PageSchemaConfirmed = true
	crawler, err := New(cfg, renderer, TemplateURLBuilder{Templates: URLTemplates{ICAO24: "https://app.airframes.io/messages?icao={icao24}"}})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, err := crawler.Crawl(ctx, []Target{{ICAO24: "A1B2C3"}}); done <- err }()
	<-renderer.started
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("crawl error=%v", err)
	}
}

func fixtureHTML(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime caller unavailable")
	}
	b, err := os.ReadFile(filepath.Clean(filepath.Join(filepath.Dir(file), "../fixtures/messages.html")))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestParseRenderedMessagesMapsMetadataAndFiltersExactTarget(t *testing.T) {
	result, err := ParseHTML(fixtureHTML(t), Target{ICAO24: "a1b2c3"}, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Messages) != 1 {
		t.Fatalf("messages=%+v", result.Messages)
	}
	m := result.Messages[0]
	if m.ID != "synthetic-1001" || m.Flight != "TVX101" || m.Tail != "N123TV" || m.Protocol != "ACARS" || m.Label != "H1" || m.FromICAO24 != "A1B2C3" || m.Mode != "2" || m.DecodeErrors != "0" || m.Decoder != "synthetic-decoder" || m.ObservedAt.Location() != time.UTC {
		t.Fatalf("normalized message=%+v", m)
	}
}

func TestParserReportsSchemaDriftAndRowBounds(t *testing.T) {
	if _, err := ParseHTML("<html><table><tr><th>whatever</th></tr></table></html>", Target{Tail: "N123TV"}, 10); !errors.Is(err, ErrSchemaDrift) {
		t.Fatalf("schema error=%v", err)
	}
	result, err := ParseHTML(fixtureHTML(t), Target{Tail: "N123TV"}, 1)
	if err != nil || len(result.Messages) != 1 || !result.Truncated {
		t.Fatalf("bounded result=%+v err=%v", result, err)
	}
}

func TestNoTargetsAndPermissionGatesNeverNavigate(t *testing.T) {
	renderer := &fixtureRenderer{page: fixtureHTML(t)}
	cfg := DefaultConfig()
	crawler, err := New(cfg, renderer, nil)
	if err != nil {
		t.Fatal(err)
	}
	result, err := crawler.Crawl(context.Background(), nil)
	if err != nil || len(result.Messages) != 0 || renderer.calls != 0 {
		t.Fatalf("empty crawl result=%+v calls=%d err=%v", result, renderer.calls, err)
	}
	target := []Target{{ICAO24: "A1B2C3"}}
	if _, err := crawler.Crawl(context.Background(), target); !errors.Is(err, ErrDisabled) || renderer.calls != 0 {
		t.Fatalf("disabled crawl err=%v calls=%d", err, renderer.calls)
	}
	cfg.LiveEnabled = true
	cfg.PermissionConfirmed = false
	crawler, err = New(cfg, renderer, TemplateURLBuilder{Templates: URLTemplates{ICAO24: "https://app.airframes.io/messages?icao={icao24}"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := crawler.Crawl(context.Background(), target); !errors.Is(err, ErrPermissionUnconfirmed) || renderer.calls != 0 {
		t.Fatalf("permission gate err=%v calls=%d", err, renderer.calls)
	}
	cfg.PermissionConfirmed = true
	crawler, err = New(cfg, renderer, TemplateURLBuilder{Templates: URLTemplates{ICAO24: "https://app.airframes.io/messages?icao={icao24}"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := crawler.Crawl(context.Background(), target); !errors.Is(err, ErrPageSchemaUnconfirmed) || renderer.calls != 0 {
		t.Fatalf("schema gate err=%v calls=%d", err, renderer.calls)
	}
}

func TestChromiumPoolIsLazyForEmptyTargets(t *testing.T) {
	cfg := DefaultConfig()
	crawler, pool, err := NewChromium(cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	result, err := crawler.Crawl(context.Background(), nil)
	if err != nil || len(result.Messages) != 0 {
		t.Fatalf("empty result=%+v err=%v", result, err)
	}
}

func TestSyntheticCrawlUsesExactTargetURLAndDoesNotReturnOtherRows(t *testing.T) {
	renderer := &fixtureRenderer{page: fixtureHTML(t)}
	cfg := DefaultConfig()
	cfg.LiveEnabled = true
	cfg.PermissionConfirmed = true
	cfg.PageSchemaConfirmed = true
	cfg.MinInterval = time.Second
	builder := TemplateURLBuilder{Templates: URLTemplates{ICAO24: "https://app.airframes.io/messages?icao={icao24}"}}
	crawler, err := New(cfg, renderer, builder)
	if err != nil {
		t.Fatal(err)
	}
	result, err := crawler.Crawl(context.Background(), []Target{{ICAO24: "a1b2c3"}})
	if err != nil {
		t.Fatal(err)
	}
	if renderer.calls != 1 || len(result.Messages) != 1 || result.Messages[0].ID != "synthetic-1001" || !strings.Contains(renderer.urls[0], "icao=A1B2C3") {
		t.Fatalf("result=%+v renderer=%+v", result, renderer)
	}
}

func TestCrawlerRejectsUnboundedURLsAndOversizedPagesBeforeReturningRows(t *testing.T) {
	renderer := &fixtureRenderer{page: fixtureHTML(t)}
	cfg := DefaultConfig()
	cfg.LiveEnabled = true
	cfg.PermissionConfirmed = true
	cfg.PageSchemaConfirmed = true
	cfg.MinInterval = time.Second
	crawler, err := New(cfg, renderer, TemplateURLBuilder{Templates: URLTemplates{ICAO24: "https://app.airframes.io/messages?note=prefix-{icao24}-suffix"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = crawler.Crawl(context.Background(), []Target{{ICAO24: "A1B2C3"}}); !errors.Is(err, ErrUnboundedTargetURL) || renderer.calls != 0 {
		t.Fatalf("unbounded URL err=%v calls=%d", err, renderer.calls)
	}
	cfg.MaxHTMLBytes = 1024
	crawler, err = New(cfg, renderer, TemplateURLBuilder{Templates: URLTemplates{ICAO24: "https://app.airframes.io/messages?icao={icao24}"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = crawler.Crawl(context.Background(), []Target{{ICAO24: "A1B2C3"}}); !errors.Is(err, ErrPageTooLarge) {
		t.Fatalf("oversize error=%v", err)
	}
}
