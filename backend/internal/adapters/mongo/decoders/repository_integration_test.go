package decoders

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	builtin "github.com/ppotepa/terminal-velocity/backend/internal/adapters/decoders"
	application "github.com/ppotepa/terminal-velocity/backend/internal/application/decoding"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/communications"
	core "github.com/ppotepa/terminal-velocity/backend/internal/core/decoding"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
)

func TestMongoDecoderConfigsResultsReconfigureAndReload(t *testing.T) {
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
	name := fmt.Sprintf("tv_decoders_test_%d", time.Now().UnixNano())
	db := client.Database(name)
	t.Cleanup(func() {
		c, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		_ = client.Database(name).Drop(c)
		_ = client.Disconnect(c)
	})
	repo := NewRepository(db)
	if err := repo.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	svc := application.NewService(repo, repo, builtin.NewRegistry())
	if err := svc.EnsureDefaults(ctx); err != nil {
		t.Fatal(err)
	}
	message := communications.AircraftMessage{ID: "message-1", Source: "fixture", SourceMessageRef: shared.Some("delivery-1"), CollectedAt: time.Now().UTC(), Direction: communications.DirectionDownlink, Bearer: communications.BearerVHF, Protocol: "acars", ContentStatus: communications.ContentProviderDecoded, OriginalText: "Q0 FLIGHT=TV123 MESSAGE=HELLO"}
	id := core.DecoderID("acars-basic")
	first, err := svc.Decode(ctx, application.DecodeRequest{Message: message, SelectedDecoderIDs: []core.DecoderID{id}})
	if err != nil || len(first.Results) != 1 || first.Results[0].Result.Status != core.DecodeDecoded {
		t.Fatalf("first=%+v err=%v", first, err)
	}
	cfg, err := repo.GetConfig(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Config.Rules = []core.MatchRule{{Field: "message_type", Operator: core.RuleEquals, Value: "Q2"}}
	if _, err := svc.Configure(ctx, cfg.Config, cfg.Revision); err != nil {
		t.Fatal(err)
	}
	second, err := svc.Decode(ctx, application.DecodeRequest{Message: message, SelectedDecoderIDs: []core.DecoderID{id}})
	if err != nil || len(second.Results) != 1 || second.Results[0].ConfigRevision != 2 || second.Results[0].Result.Status != core.DecodeUnsupported {
		t.Fatalf("second=%+v err=%v", second, err)
	}
	if err := client.Disconnect(ctx); err != nil {
		t.Fatal(err)
	}
	client, err = driver.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		t.Fatal(err)
	}
	if err = client.Ping(ctx, readpref.Primary()); err != nil {
		t.Fatal(err)
	}
	repo = NewRepository(client.Database(name))
	svc = application.NewService(repo, repo, builtin.NewRegistry())
	cfg, err = repo.GetConfig(ctx, id)
	if err != nil || cfg.Revision != 2 {
		t.Fatalf("config=%+v err=%v", cfg, err)
	}
	page, err := svc.History(ctx, message.ID, "", 1)
	if err != nil || len(page.Items) != 1 || !page.Next.Valid {
		t.Fatalf("page=%+v err=%v", page, err)
	}
	next, err := svc.History(ctx, message.ID, page.Next.Value, 1)
	if err != nil || len(next.Items) != 1 || next.Items[0].ConfigRevision == page.Items[0].ConfigRevision {
		t.Fatalf("next=%+v err=%v", next, err)
	}
}
