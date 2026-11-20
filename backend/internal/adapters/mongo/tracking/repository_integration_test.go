package tracking

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	application "github.com/ppotepa/terminal-velocity/backend/internal/application/tracking"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/flight"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
)

func TestMongoPositionIngestIndexesTrackAndReload(t *testing.T) {
	uri := os.Getenv("TV_TEST_MONGO_URI")
	if uri == "" {
		t.Skip("set TV_TEST_MONGO_URI to run MongoDB integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	name := fmt.Sprintf("tv_tracking_test_%d", time.Now().UnixNano())
	client, err := connectTracking(ctx, uri)
	if err != nil {
		t.Fatal("connect Mongo fixture")
	}
	db := client.Database(name)
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Database(name).Drop(c)
		_ = client.Disconnect(c)
	})
	repo := NewRepository(db)
	if err := repo.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	svc := application.NewService(repo)
	start := time.Now().UTC().Truncate(time.Second)
	for i, p := range []struct{ lat, lon float64 }{{51, 7}, {51.01, 7.01}} {
		req := application.IngestRequest{AircraftID: "aircraft1", FlightID: shared.Some(shared.FlightID("flight1")), Observation: flight.PositionObservation{SourceObservationID: fmt.Sprintf("p%d", i), Source: "fixture", ObservedAt: shared.ObservationTime{Time: start.Add(time.Duration(i) * time.Minute)}, Latitude: p.lat, Longitude: p.lon}, QualityRank: 70}
		if _, _, err := svc.Ingest(ctx, req); err != nil {
			t.Fatal(err)
		}
	}
	duplicate := application.IngestRequest{AircraftID: "aircraft1", FlightID: shared.Some(shared.FlightID("flight1")), Observation: flight.PositionObservation{SourceObservationID: "p1", Source: "fixture", ObservedAt: shared.ObservationTime{Time: start.Add(time.Minute)}, Latitude: 51.01, Longitude: 7.01}, QualityRank: 70}
	if _, accepted, err := svc.Ingest(ctx, duplicate); err != nil || accepted {
		t.Fatalf("duplicate accepted=%v err=%v", accepted, err)
	}
	late := application.IngestRequest{AircraftID: "aircraft1", FlightID: shared.Some(shared.FlightID("flight1")), Observation: flight.PositionObservation{SourceObservationID: "late", Source: "fixture", ObservedAt: shared.ObservationTime{Time: start.Add(-time.Minute)}, Latitude: 50, Longitude: 6}, QualityRank: 100}
	if _, accepted, err := svc.Ingest(ctx, late); err != nil || accepted {
		t.Fatalf("late accepted=%v err=%v", accepted, err)
	}
	page, err := svc.FlightTrack(ctx, "flight1", start.Add(-time.Hour), start.Add(time.Hour), nil, 10)
	if err != nil || len(page.Segments) != 2 || len(page.Segments[0].Points) != 1 || len(page.Segments[1].Points) != 2 {
		t.Fatalf("track=%+v err=%v", page, err)
	}
	if err := client.Disconnect(ctx); err != nil {
		t.Fatal(err)
	}
	client, err = connectTracking(ctx, uri)
	if err != nil {
		t.Fatal("reconnect Mongo fixture")
	}
	repo = NewRepository(client.Database(name))
	current, err := repo.GetCurrent(ctx, "aircraft1")
	if err != nil || current.Observation.SourceObservationID != "p1" || current.Version != 2 {
		t.Fatalf("reloaded current=%+v err=%v", current, err)
	}
	page, err = application.NewService(repo).FlightTrack(ctx, "flight1", start.Add(-time.Hour), start.Add(time.Hour), nil, 10)
	if err != nil || len(page.Segments) != 2 || len(page.Segments[0].Points) != 1 || len(page.Segments[1].Points) != 2 {
		t.Fatalf("reloaded track=%+v err=%v", page, err)
	}
}

func connectTracking(ctx context.Context, uri string) (*driver.Client, error) {
	client, err := driver.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		return nil, err
	}
	if err = client.Ping(ctx, readpref.Primary()); err != nil {
		_ = client.Disconnect(ctx)
		return nil, err
	}
	return client, nil
}
