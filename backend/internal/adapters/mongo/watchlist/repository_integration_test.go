package watchlist

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	application "github.com/ppotepa/terminal-velocity/backend/internal/application/watchlist"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/watch"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
)

func TestMongoWatchlistCRUDVersioningAndReload(t *testing.T) {
	uri := os.Getenv("TV_TEST_MONGO_URI")
	if uri == "" {
		t.Skip("set TV_TEST_MONGO_URI to run MongoDB integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	databaseName := fmt.Sprintf("tv_watchlist_test_%d", time.Now().UnixNano())
	client, err := connect(ctx, uri)
	if err != nil {
		t.Fatal("connect to MongoDB integration fixture")
	}
	db := client.Database(databaseName)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		if client == nil {
			return
		}
		_ = client.Database(databaseName).Drop(cleanupCtx)
		_ = client.Disconnect(cleanupCtx)
	})

	repository := NewRepository(db)
	if err := repository.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	service := application.NewService(repository)
	one, err := service.Create(ctx, integrationRule(""))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Create(ctx, one.Rule); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("duplicate ID error = %v, want conflict", err)
	}
	two, err := service.Create(ctx, integrationRule(""))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Disable(ctx, one.Rule.ID, one.Version); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Enable(ctx, one.Rule.ID, one.Version); !errors.Is(err, application.ErrVersionConflict) {
		t.Fatalf("stale update error = %v, want version conflict", err)
	}

	if err := client.Disconnect(ctx); err != nil {
		t.Fatal("disconnect before application reload")
	}
	client, err = connect(ctx, uri)
	if err != nil {
		t.Fatal("reconnect for application reload")
	}
	repository = NewRepository(client.Database(databaseName))
	service = application.NewService(repository)
	reloaded, err := service.Get(ctx, one.Rule.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Rule.Status != watch.StatusPaused || reloaded.Version != 2 {
		t.Fatalf("disable did not persist across reconnect: %+v", reloaded)
	}
	updatedRule := reloaded.Rule
	updatedRule.Name = "Edited Mongo integration watch"
	updated, err := service.Update(ctx, reloaded.Rule.ID, reloaded.Version, updatedRule)
	if err != nil || updated.Version != 3 || updated.Rule.Name != updatedRule.Name {
		t.Fatalf("update failed: item=%+v err=%v", updated, err)
	}
	enabledRule, err := service.Enable(ctx, updated.Rule.ID, updated.Version)
	if err != nil || enabledRule.Rule.Status != watch.StatusActive || enabledRule.Version != 4 {
		t.Fatalf("enable failed: item=%+v err=%v", enabledRule, err)
	}
	pausedAgain, err := service.Disable(ctx, enabledRule.Rule.ID, enabledRule.Version)
	if err != nil || pausedAgain.Version != 5 {
		t.Fatalf("second disable failed: item=%+v err=%v", pausedAgain, err)
	}
	enabled, next, err := service.ListEnabled(ctx, "", 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(enabled) != 1 || enabled[0].Rule.ID != two.Rule.ID || next != "" {
		t.Fatalf("enabled rules = %+v, cursor=%q", enabled, next)
	}
	if err := service.Remove(ctx, one.Rule.ID, pausedAgain.Version); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Get(ctx, one.Rule.ID); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("removed rule lookup error = %v, want not found", err)
	}
}

func connect(ctx context.Context, uri string) (*driver.Client, error) {
	client, err := driver.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		return nil, errors.New("MongoDB client creation failed")
	}
	if err := client.Ping(ctx, readpref.Primary()); err != nil {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Disconnect(cleanupCtx)
		return nil, errors.New("MongoDB ping failed")
	}
	return client, nil
}

func integrationRule(id string) watch.WatchRule {
	return watch.WatchRule{
		ID: shared.WatchRuleID(id), Name: "Mongo integration watch", Status: watch.StatusActive, Scope: watch.ScopeTargeted,
		Groups:     []watch.CriteriaGroup{{Mode: watch.GroupAny, Criteria: []watch.Criterion{{Kind: watch.CriterionICAO24, Value: "A1B2C3"}}}},
		Collection: watch.CollectionPreferences{Positions: true},
	}
}
