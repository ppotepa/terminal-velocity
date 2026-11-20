// Package crawler contains the bounded, target-filtered Airframes page adapter.
// Live acquisition is intentionally disabled unless an operator explicitly
// enables it after confirming source permissions and the current page schema.
package crawler

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
)

var (
	ErrDisabled              = errors.New("Airframes live crawler is disabled")
	ErrPermissionUnconfirmed = errors.New("Airframes permission has not been confirmed")
	ErrPageSchemaUnconfirmed = errors.New("Airframes page schema and target filters have not been verified")
	ErrSchemaDrift           = errors.New("Airframes message page schema drift")
	ErrUnboundedTargetURL    = errors.New("target URL is not explicitly filtered for one target")
)

const DefaultLiveEnabled = false

type Target struct {
	ICAO24 string
	Tail   string
	Flight string
}
type targetKind uint8

const (
	targetICAO targetKind = iota + 1
	targetTail
	targetFlight
)

func (t Target) normalized() (Target, targetKind, error) {
	count := 0
	var kind targetKind
	out := t
	if strings.TrimSpace(t.ICAO24) != "" {
		count++
		kind = targetICAO
		id, err := shared.NewICAO24(t.ICAO24)
		if err != nil {
			return Target{}, 0, err
		}
		out.ICAO24 = string(id)
	}
	if strings.TrimSpace(t.Tail) != "" {
		count++
		kind = targetTail
		id, err := shared.NewRegistration(t.Tail)
		if err != nil {
			return Target{}, 0, err
		}
		out.Tail = string(id)
	}
	if strings.TrimSpace(t.Flight) != "" {
		count++
		kind = targetFlight
		id, err := shared.NewCallsign(t.Flight)
		if err != nil {
			return Target{}, 0, err
		}
		out.Flight = string(id)
	}
	if count != 1 {
		return Target{}, 0, shared.NewDomainError(shared.ErrInvalidInput, "crawler target must specify exactly one ICAO24, tail, or flight filter")
	}
	return out, kind, nil
}

type URLTemplates struct {
	ICAO24 string
	Tail   string
	Flight string
}
type Config struct {
	LiveEnabled bool
	// PermissionConfirmed requires provider approval for this specific use.
	PermissionConfirmed bool
	// PageSchemaConfirmed requires current rendered selectors and per-target
	// filtering to have been manually verified against the live page.
	PageSchemaConfirmed bool
	MaxConcurrent       int
	MaxTargetsPerRun    int
	MaxRowsPerTarget    int
	MaxHTMLBytes        int
	NavigationTimeout   time.Duration
	RequestTimeout      time.Duration
	MinInterval         time.Duration
	ReadySelector       string
}

func DefaultConfig() Config {
	return Config{LiveEnabled: DefaultLiveEnabled, MaxConcurrent: 2, MaxTargetsPerRun: 20, MaxRowsPerTarget: 100, MaxHTMLBytes: 2 * 1024 * 1024, NavigationTimeout: 15 * time.Second, RequestTimeout: 25 * time.Second, MinInterval: time.Second, ReadySelector: "body"}
}

func (c Config) validate() error {
	if c.MaxConcurrent < 1 || c.MaxConcurrent > 4 || c.MaxTargetsPerRun < 1 || c.MaxTargetsPerRun > 100 || c.MaxRowsPerTarget < 1 || c.MaxRowsPerTarget > 100 || c.MaxHTMLBytes < 1024 || c.MaxHTMLBytes > 8*1024*1024 {
		return fmt.Errorf("crawler bounds are outside the supported limits")
	}
	if c.NavigationTimeout <= 0 || c.NavigationTimeout > 30*time.Second || c.RequestTimeout < c.NavigationTimeout || c.RequestTimeout > 60*time.Second || c.MinInterval < time.Second {
		return fmt.Errorf("crawler time and rate budgets are invalid")
	}
	if strings.TrimSpace(c.ReadySelector) == "" {
		return fmt.Errorf("rendered page ready selector is required")
	}
	return nil
}

type Message struct {
	ID           string    `json:"id"`
	ObservedAt   time.Time `json:"observed_at"`
	Flight       string    `json:"flight,omitempty"`
	Tail         string    `json:"tail,omitempty"`
	FromICAO24   string    `json:"from_icao24,omitempty"`
	ToICAO24     string    `json:"to_icao24,omitempty"`
	Label        string    `json:"label,omitempty"`
	Text         string    `json:"text"`
	Source       string    `json:"source,omitempty"`
	Protocol     string    `json:"protocol,omitempty"`
	Mode         string    `json:"mode,omitempty"`
	DecodeErrors string    `json:"decode_errors,omitempty"`
	Frequency    string    `json:"frequency,omitempty"`
	Channel      string    `json:"channel,omitempty"`
	Decoder      string    `json:"decoder,omitempty"`
}

type Result struct {
	Messages  []Message
	Truncated bool
}
type PageRenderer interface {
	Render(context.Context, string, string, int) (string, error)
}
type URLBuilder interface{ Build(Target) (string, error) }

type Crawler struct {
	config      Config
	renderer    PageRenderer
	urls        URLBuilder
	rateMu      sync.Mutex
	nextRequest time.Time
}

func New(config Config, renderer PageRenderer, builder URLBuilder) (*Crawler, error) {
	if err := config.validate(); err != nil {
		return nil, err
	}
	return &Crawler{config: config, renderer: renderer, urls: builder}, nil
}

// Crawl never opens a browser for an empty target list. Each navigation must
// use a validated exact-target URL and every returned row is checked again.
func (c *Crawler) Crawl(ctx context.Context, targets []Target) (Result, error) {
	result := Result{Messages: []Message{}}
	if len(targets) == 0 {
		return result, nil
	}
	if len(targets) > c.config.MaxTargetsPerRun {
		return Result{}, fmt.Errorf("target count %d exceeds limit %d", len(targets), c.config.MaxTargetsPerRun)
	}
	if !c.config.LiveEnabled {
		return Result{}, ErrDisabled
	}
	if !c.config.PermissionConfirmed {
		return Result{}, ErrPermissionUnconfirmed
	}
	if !c.config.PageSchemaConfirmed {
		return Result{}, ErrPageSchemaUnconfirmed
	}
	if c.renderer == nil || c.urls == nil {
		return Result{}, fmt.Errorf("Airframes renderer and target URL builder are required")
	}
	seen := map[string]bool{}
	for _, raw := range targets {
		if err := ctx.Err(); err != nil {
			return Result{}, err
		}
		target, kind, err := raw.normalized()
		if err != nil {
			return Result{}, err
		}
		targetKey := fmt.Sprintf("%d:%s", kind, target.ICAO24+target.Tail+target.Flight)
		if seen[targetKey] {
			continue
		}
		seen[targetKey] = true
		pageURL, err := c.urls.Build(target)
		if err != nil {
			return Result{}, err
		}
		if err = validateTargetURL(pageURL, target, kind); err != nil {
			return Result{}, err
		}
		if err = c.waitRate(ctx); err != nil {
			return Result{}, err
		}
		requestCtx, cancel := context.WithTimeout(ctx, c.config.RequestTimeout)
		html, err := c.renderer.Render(requestCtx, pageURL, c.config.ReadySelector, c.config.MaxHTMLBytes)
		cancel()
		if err != nil {
			return Result{}, fmt.Errorf("render target page: %w", err)
		}
		if len(html) > c.config.MaxHTMLBytes {
			return Result{}, ErrPageTooLarge
		}
		page, err := ParseHTML(html, target, c.config.MaxRowsPerTarget)
		if err != nil {
			return Result{}, err
		}
		result.Truncated = result.Truncated || page.Truncated
		for _, message := range page.Messages {
			key := message.ID
			if seen["message:"+key] {
				continue
			}
			seen["message:"+key] = true
			result.Messages = append(result.Messages, message)
		}
	}
	return result, nil
}

func (c *Crawler) waitRate(ctx context.Context) error {
	c.rateMu.Lock()
	wait := time.Until(c.nextRequest)
	if wait < 0 {
		wait = 0
	}
	c.nextRequest = time.Now().Add(wait + c.config.MinInterval)
	c.rateMu.Unlock()
	if wait == 0 {
		return ctx.Err()
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func validateTargetURL(raw string, target Target, kind targetKind) error {
	u, err := url.Parse(raw)
	if err != nil {
		return err
	}
	if u.Scheme != "https" || u.Hostname() != "app.airframes.io" || u.User != nil || (u.Port() != "" && u.Port() != "443") {
		return fmt.Errorf("Airframes target URL must use HTTPS on app.airframes.io")
	}
	value := target.ICAO24
	if kind == targetTail {
		value = target.Tail
	} else if kind == targetFlight {
		value = target.Flight
	}
	matched := false
	pathParts := strings.Split(strings.Trim(u.EscapedPath(), "/"), "/")
	for i, part := range pathParts {
		if strings.EqualFold(part, url.PathEscape(value)) && i > 0 {
			previous := strings.ToLower(pathParts[i-1])
			if kind == targetICAO && (previous == "icao" || previous == "icao24" || previous == "airframes") || kind == targetTail && (previous == "tail" || previous == "registration") || kind == targetFlight && (previous == "flight" || previous == "flights") {
				matched = true
			}
		}
	}
	allowedKeys := map[targetKind]map[string]bool{
		targetICAO:   {"icao": true, "icao24": true, "hex": true},
		targetTail:   {"tail": true, "registration": true},
		targetFlight: {"flight": true, "flight_number": true, "callsign": true},
	}[kind]
	for key, values := range u.Query() {
		if !allowedKeys[strings.ToLower(key)] {
			continue
		}
		for _, candidate := range values {
			if strings.EqualFold(candidate, value) {
				matched = true
			}
		}
	}
	if !matched {
		return ErrUnboundedTargetURL
	}
	return nil
}
