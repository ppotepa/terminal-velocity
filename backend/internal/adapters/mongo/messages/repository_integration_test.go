package messages

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	application "github.com/ppotepa/terminal-velocity/backend/internal/application/messages"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/communications"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
)

func TestMongoMessageDeliveryDedupConflictAndBoundedHistory(t *testing.T) {
	uri := os.Getenv("TV_TEST_MONGO_URI")
	if uri == "" {
		t.Skip("set TV_TEST_MONGO_URI to run MongoDB integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	client, err := driver.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		t.Fatal(err)
	}
	if err = client.Ping(ctx, readpref.Primary()); err != nil {
		t.Fatal(err)
	}
	name := fmt.Sprintf("tv_messages_test_%d", time.Now().UnixNano())
	db := client.Database(name)
	t.Cleanup(func() {
		c, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		_ = db.Drop(c)
		_ = client.Disconnect(c)
	})
	repo := NewRepository(db)
	if err := repo.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	svc := application.NewService(repo, nil)
	at := time.Now().UTC().Truncate(time.Millisecond)
	for _, ref := range []string{"d1", "d2", "d3"} {
		_, err := svc.Ingest(ctx, application.IngestRequest{Message: communications.AircraftMessage{ID: "source-id", Source: "fixture", SourceMessageRef: shared.Some(ref), ObservedAt: shared.Some(shared.ObservationTime{Time: at}), CollectedAt: at, Direction: communications.DirectionDownlink, Bearer: communications.BearerVHF, Protocol: "acars", ContentStatus: communications.ContentRaw, OriginalText: "fixture"}, WatchRuleIDs: []shared.WatchRuleID{"r1"}, Policy: application.StoragePolicy{AllowMetadata: true, AllowOriginalText: true}})
		if err != nil {
			t.Fatal(err)
		}
	}
	dupe, err := svc.Ingest(ctx, application.IngestRequest{Message: communications.AircraftMessage{ID: "another-id", Source: "fixture", SourceMessageRef: shared.Some("d2"), ObservedAt: shared.Some(shared.ObservationTime{Time: at}), CollectedAt: at.Add(time.Second), Direction: communications.DirectionDownlink, Bearer: communications.BearerVHF, Protocol: "acars", ContentStatus: communications.ContentRaw, OriginalText: "fixture"}, WatchRuleIDs: []shared.WatchRuleID{"r1"}, Policy: application.StoragePolicy{AllowMetadata: true, AllowOriginalText: true}})
	if err != nil || dupe.Created {
		t.Fatalf("dupe=%+v err=%v", dupe, err)
	}
	_, err = svc.Ingest(ctx, application.IngestRequest{Message: communications.AircraftMessage{ID: "new-id", Source: "fixture", SourceMessageRef: shared.Some("d2"), ObservedAt: shared.Some(shared.ObservationTime{Time: at}), CollectedAt: at, Direction: communications.DirectionDownlink, Bearer: communications.BearerVHF, Protocol: "acars", ContentStatus: communications.ContentRaw, OriginalText: "changed"}, WatchRuleIDs: []shared.WatchRuleID{"r1"}, Policy: application.StoragePolicy{AllowMetadata: true, AllowOriginalText: true}})
	if err != application.ErrConflict {
		t.Fatalf("conflict err=%v", err)
	}
	page, err := svc.History(ctx, application.Query{WatchRuleID: shared.Some(shared.WatchRuleID("r1")), Limit: 2})
	if err != nil || len(page.Items) != 2 || !page.Next.Valid {
		t.Fatalf("page=%+v err=%v", page, err)
	}
	next, err := svc.History(ctx, application.Query{WatchRuleID: shared.Some(shared.WatchRuleID("r1")), After: page.Next, Limit: 2})
	if err != nil || len(next.Items) != 1 {
		t.Fatalf("next=%+v err=%v", next, err)
	}
}
