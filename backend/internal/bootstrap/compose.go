package bootstrap

import (
	"context"
	"errors"
	"time"

	builtin "github.com/ppotepa/terminal-velocity/backend/internal/adapters/decoders"
	"github.com/ppotepa/terminal-velocity/backend/internal/adapters/mongo/alerts"
	decoderstore "github.com/ppotepa/terminal-velocity/backend/internal/adapters/mongo/decoders"
	messagestore "github.com/ppotepa/terminal-velocity/backend/internal/adapters/mongo/messages"
	trackingstore "github.com/ppotepa/terminal-velocity/backend/internal/adapters/mongo/tracking"
	watchstore "github.com/ppotepa/terminal-velocity/backend/internal/adapters/mongo/watchlist"
	decodeapp "github.com/ppotepa/terminal-velocity/backend/internal/application/decoding"
	"github.com/ppotepa/terminal-velocity/backend/internal/application/events"
	trackingapp "github.com/ppotepa/terminal-velocity/backend/internal/application/tracking"
	watchapp "github.com/ppotepa/terminal-velocity/backend/internal/application/watchlist"
	transport "github.com/ppotepa/terminal-velocity/backend/internal/transport/http"
	aircrafthttp "github.com/ppotepa/terminal-velocity/backend/internal/transport/http/aircraft"
	decoderhttp "github.com/ppotepa/terminal-velocity/backend/internal/transport/http/decoders"
	sourcehttp "github.com/ppotepa/terminal-velocity/backend/internal/transport/http/sourcecontrol"
	watchhttp "github.com/ppotepa/terminal-velocity/backend/internal/transport/http/watchlist"
	ssehttp "github.com/ppotepa/terminal-velocity/backend/internal/transport/sse"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
)

// Compose installs persistence indexes and constructs the implemented HTTP
// features exactly once. Data acquisition providers remain inactive unless a
// separately configured, permitted source is wired in a later composition.
func Compose(ctx context.Context, db *driver.Database) (transport.Endpoints, error) {
	if db == nil {
		return transport.Endpoints{}, errors.New("MongoDB database is required")
	}
	watchRepo := watchstore.NewRepository(db)
	trackRepo := trackingstore.NewRepository(db)
	messageRepo := messagestore.NewRepository(db)
	decoderRepo := decoderstore.NewRepository(db)
	alertRepo := alerts.NewRepository(db)
	for _, ensure := range []func(context.Context) error{watchRepo.EnsureIndexes, trackRepo.EnsureIndexes, messageRepo.EnsureIndexes, decoderRepo.EnsureIndexes, alertRepo.EnsureIndexes} {
		if err := ensure(ctx); err != nil {
			return transport.Endpoints{}, errors.New("MongoDB index initialization failed")
		}
	}
	watchService := watchapp.NewService(watchRepo)
	trackingService := trackingapp.NewService(trackRepo)
	registry := builtin.NewRegistry()
	decoderService := decodeapp.NewService(decoderRepo, decoderRepo, registry)
	if err := decoderService.EnsureDefaults(ctx); err != nil {
		return transport.Endpoints{}, errors.New("built-in decoder initialization failed")
	}
	hub := events.NewHub(events.DefaultHistory, events.DefaultBuffer)
	return transport.Endpoints{
		WatchRules: watchhttp.NewHandler(watchService, nil),
		Aircraft:   aircrafthttp.NewHandler(aircraftReader{tracking: trackingService}),
		Decoders:   decoderhttp.NewHandler(decoderReader{service: decoderService, configs: decoderRepo, registry: registry}),
		Sources:    sourcehttp.NewHandler(staticSourceHealth{}),
		Events:     ssehttp.NewHandler(hub, 20*time.Second),
	}, nil
}

type staticSourceHealth struct{}

func (staticSourceHealth) ListSourceHealth(context.Context) ([]sourcehttp.Health, error) {
	return []sourcehttp.Health{
		{ID: "opensky", Status: "inactive", Freshness: "unknown", Enabled: false},
		{ID: "airframes-crawler", Status: "inactive", Freshness: "unknown", Enabled: false},
		{ID: "airframes-api", Status: "inactive", Freshness: "unknown", Enabled: false},
	}, nil
}
