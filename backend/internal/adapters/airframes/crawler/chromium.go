package crawler

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/chromedp/chromedp"
)

var ErrPageTooLarge = errors.New("rendered Airframes page exceeds configured size limit")

// ChromiumPool shares one headless Chrome process and bounds concurrent tabs.
// It starts lazily, so constructing it or crawling no targets performs no I/O.
type ChromiumPool struct {
	root              context.Context
	stop              context.CancelFunc
	maxConcurrent     int
	navigationTimeout time.Duration
	semaphore         chan struct{}
	startOnce         sync.Once
	startErr          error
	closed            bool
	mu                sync.Mutex
}

func NewChromiumPool(maxConcurrent int, navigationTimeout time.Duration) (*ChromiumPool, error) {
	if maxConcurrent < 1 || maxConcurrent > 4 || navigationTimeout <= 0 {
		return nil, fmt.Errorf("invalid Chromium pool bounds")
	}
	allocator, stopAllocator := chromedp.NewExecAllocator(context.Background(), chromedp.DefaultExecAllocatorOptions[:]...)
	root, stopBrowser := chromedp.NewContext(allocator)
	return &ChromiumPool{root: root, stop: func() { stopBrowser(); stopAllocator() }, maxConcurrent: maxConcurrent, navigationTimeout: navigationTimeout, semaphore: make(chan struct{}, maxConcurrent)}, nil
}

// NewChromium creates one crawler and its shared lazy browser pool. The caller
// owns the returned pool and must close it during application shutdown.
func NewChromium(config Config, builder URLBuilder) (*Crawler, *ChromiumPool, error) {
	if err := config.validate(); err != nil {
		return nil, nil, err
	}
	pool, err := NewChromiumPool(config.MaxConcurrent, config.NavigationTimeout)
	if err != nil {
		return nil, nil, err
	}
	crawler, err := New(config, pool, builder)
	if err != nil {
		pool.Close()
		return nil, nil, err
	}
	return crawler, pool, nil
}

func (p *ChromiumPool) Render(ctx context.Context, pageURL, readySelector string, maxBytes int) (string, error) {
	select {
	case p.semaphore <- struct{}{}:
	case <-ctx.Done():
		return "", ctx.Err()
	}
	defer func() { <-p.semaphore }()
	p.mu.Lock()
	closed := p.closed
	p.mu.Unlock()
	if closed {
		return "", errors.New("Chromium pool is closed")
	}
	p.startOnce.Do(func() {
		started := make(chan error, 1)
		go func() { started <- chromedp.Do(p.root) }()
		select {
		case p.startErr = <-started:
		case <-ctx.Done():
			p.startErr = ctx.Err()
			p.Close()
		}
	})
	if p.startErr != nil {
		return "", fmt.Errorf("start Chromium: %w", p.startErr)
	}
	tab, closeTab := chromedp.NewContext(p.root)
	defer closeTab()
	stopOnRequestCancel := context.AfterFunc(ctx, closeTab)
	defer stopOnRequestCancel()
	navCtx, cancel := context.WithTimeout(tab, p.navigationTimeout)
	defer cancel()
	if err := chromedp.Do(navCtx, chromedp.Navigate(pageURL), chromedp.WaitVisible(chromedp.CSS(readySelector))); err != nil {
		return "", fmt.Errorf("navigate Airframes page: %w", err)
	}
	pageSize, err := chromedp.Run(navCtx, chromedp.Evaluate[int]("document.documentElement ? document.documentElement.outerHTML.length : 0"))
	if err != nil {
		return "", fmt.Errorf("measure rendered Airframes page: %w", err)
	}
	if pageSize > maxBytes {
		return "", ErrPageTooLarge
	}
	rendered, err := chromedp.Run(navCtx, chromedp.Evaluate[string]("document.documentElement ? document.documentElement.outerHTML : ''"))
	if err != nil {
		return "", fmt.Errorf("read rendered Airframes page: %w", err)
	}
	if len(rendered) > maxBytes {
		return "", ErrPageTooLarge
	}
	return rendered, nil
}

func (p *ChromiumPool) Close() {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	p.closed = true
	p.mu.Unlock()
	p.stop()
}

var _ PageRenderer = (*ChromiumPool)(nil)
