package bootstrap

import (
	"context"
	"errors"
	"log"
	"os"
	"time"

	builtin "github.com/ppotepa/terminal-velocity/backend/internal/adapters/decoders"
	"github.com/ppotepa/terminal-velocity/backend/internal/adapters/mongo/alerts"
	decoderstore "github.com/ppotepa/terminal-velocity/backend/internal/adapters/mongo/decoders"
	messagestore "github.com/ppotepa/terminal-velocity/backend/internal/adapters/mongo/messages"
	trackingstore "github.com/ppotepa/terminal-velocity/backend/internal/adapters/mongo/tracking"
	watchstore "github.com/ppotepa/terminal-velocity/backend/internal/adapters/mongo/watchlist"
	"github.com/ppotepa/terminal-velocity/backend/internal/application/acquisition"
	alertapp "github.com/ppotepa/terminal-velocity/backend/internal/application/alerting"
	decodeapp "github.com/ppotepa/terminal-velocity/backend/internal/application/decoding"
	"github.com/ppotepa/terminal-velocity/backend/internal/application/events"
	messageapp "github.com/ppotepa/terminal-velocity/backend/internal/application/messages"
	trackingapp "github.com/ppotepa/terminal-velocity/backend/internal/application/tracking"
	watchapp "github.com/ppotepa/terminal-velocity/backend/internal/application/watchlist"
	"github.com/ppotepa/terminal-velocity/backend/internal/ports/sources"
	transport "github.com/ppotepa/terminal-velocity/backend/internal/transport/http"
	aircrafthttp "github.com/ppotepa/terminal-velocity/backend/internal/transport/http/aircraft"
	alerthttp "github.com/ppotepa/terminal-velocity/backend/internal/transport/http/alerts"
	decoderhttp "github.com/ppotepa/terminal-velocity/backend/internal/transport/http/decoders"
	messagehttp "github.com/ppotepa/terminal-velocity/backend/internal/transport/http/messages"
	sourcehttp "github.com/ppotepa/terminal-velocity/backend/internal/transport/http/sourcecontrol"
	watchhttp "github.com/ppotepa/terminal-velocity/backend/internal/transport/http/watchlist"
	ssehttp "github.com/ppotepa/terminal-velocity/backend/internal/transport/sse"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
)

// Composition owns process-level handlers and opt-in background jobs.
type Composition struct {
	Endpoints transport.Endpoints
	jobs      []func(context.Context) error
}

func (c Composition) Start(ctx context.Context) {
	for _, job := range c.jobs {
		go func(run func(context.Context) error) {
			if err := run(ctx); err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("background acquisition stopped: %v", err)
			}
		}(job)
	}
}

// Compose installs persistence indexes and constructs the implemented HTTP
// features once. The deterministic fixture source is opt-in; real providers
// remain inactive until their license and credentials are configured.
func Compose(ctx context.Context, db *driver.Database, syntheticMode ...bool) (Composition, error) {
	if db == nil {
		return Composition{}, errors.New("MongoDB database is required")
	}
	watchRepo := watchstore.NewRepository(db)
	trackRepo := trackingstore.NewRepository(db)
	messageRepo := messagestore.NewRepository(db)
	decoderRepo := decoderstore.NewRepository(db)
	alertRepo := alerts.NewRepository(db)
	for _, ensure := range []func(context.Context) error{watchRepo.EnsureIndexes, trackRepo.EnsureIndexes, messageRepo.EnsureIndexes, decoderRepo.EnsureIndexes, alertRepo.EnsureIndexes} {
		if err := ensure(ctx); err != nil {
			return Composition{}, errors.New("MongoDB index initialization failed")
		}
	}
	watchService := watchapp.NewService(watchRepo)
	trackingService := trackingapp.NewService(trackRepo)
	registry := builtin.NewRegistry()
	decoderService := decodeapp.NewService(decoderRepo, decoderRepo, registry)
	messageService := messageapp.NewService(messageRepo, fixtureCorrelator{})
	if err := decoderService.EnsureDefaults(ctx); err != nil {
		return Composition{}, errors.New("built-in decoder initialization failed")
	}
	hub := events.NewHub(events.DefaultHistory, events.DefaultBuffer)
	fixtureEnabled := len(syntheticMode) > 0 && syntheticMode[0]
	var alertScope alertapp.ScopeVerifier
	var alertEvidence alertapp.EvidenceVerifier
	if fixtureEnabled {
		alertScope = fixtureAlertScope{rules: watchService}
		alertEvidence = fixtureAlertEvidence{db: db}
	}
	alertService := alertapp.NewService(alertRepo, alertScope, alertEvidence)
	var jobs []func(context.Context) error
	if fixtureEnabled {
		countryService, err := loadFixtureCountryService()
		if err != nil {
			return Composition{}, err
		}
		source := fixtureSource{}
		scheduler := acquisition.NewScheduler(watchService, []sources.Source{source}, newMemoryCheckpoints(), fixtureConsumer{rules: watchService, tracking: trackingService, messages: messageService, decoders: decoderService, alerts: alertService, geography: countryService, db: db, hub: hub}.Consume, 5*time.Second)
		jobs = append(jobs, scheduler.Run)
	}
	return Composition{Endpoints: transport.Endpoints{
		Workspace:  transport.WorkspaceProxy(os.Getenv("TV_WORKSPACE_SOCKET")),
		WatchRules: publishWatchlistChanges(watchhttp.NewHandler(watchService, nil), hub),
		Aircraft:   aircrafthttp.NewHandler(aircraftReader{tracking: trackingService, rules: watchService}),
		Decoders:   decoderhttp.NewHandler(decoderReader{service: decoderService, configs: decoderRepo, registry: registry}),
		Messages:   messagehttp.NewHandler(messageReader{messages: messageService, decoders: decoderService, rules: watchService}),
		Alerts:     alerthttp.NewHandler(alertReader{service: alertService, repo: alertRepo, db: db}),
		Sources:    sourcehttp.NewHandler(staticSourceHealth{synthetic: fixtureEnabled}),
		Events:     ssehttp.NewHandler(hub, 20*time.Second),
	}, jobs: jobs}, nil
}

type staticSourceHealth struct{ synthetic bool }

func (static staticSourceHealth) ListSourceHealth(context.Context) ([]sourcehttp.Health, error) {
	rows := []sourcehttp.Health{
		{ID: "opensky", Status: "blocked", Freshness: "unknown", Enabled: false},
		{ID: "airframes-crawler", Status: "blocked", Freshness: "unknown", Enabled: false},
		{ID: "airframes-api", Status: "not_configured", Freshness: "unknown", Enabled: false},
	}
	if static.synthetic {
		rows = append(rows, sourcehttp.Health{ID: "synthetic-fixture", Status: "synthetic", Freshness: "unknown", Enabled: true})
	}
	return rows, nil
}
