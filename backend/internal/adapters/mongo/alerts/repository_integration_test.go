package alerts

import (
	"context"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	application "github.com/ppotepa/terminal-velocity/backend/internal/application/alerting"
	core "github.com/ppotepa/terminal-velocity/backend/internal/core/alerting"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
)

type watchedScope struct{}

func (watchedScope) IsWatched(context.Context, core.Subject) (bool, error) { return true, nil }

type verifiedEvidence struct{}

func (verifiedEvidence) Verify(_ context.Context, _ core.AlertRule, o core.Observation) (core.Truth, error) {
	if o.EventID == "" || o.Evidence == "" {
		return core.TruthUnknown, fmt.Errorf("missing evidence")
	}
	return o.Truth, nil
}

func TestMongoAlertTransitionsOutboxPersistenceAndAcknowledgement(t *testing.T) {
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
	name := fmt.Sprintf("tv_alerts_test_%d", time.Now().UnixNano())
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
	svc := application.NewService(repo, watchedScope{}, verifiedEvidence{})
	rule, err := svc.CreateRule(ctx, core.AlertRule{ID: "rule-1", Name: "Flight started", Condition: core.ConditionFlightStarted, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	subject := core.Subject{AircraftID: shared.Some(shared.AircraftID("aircraft-1")), FlightID: shared.Some(shared.FlightID("flight-1"))}
	obs := core.Observation{EventID: "first", Subject: subject, At: shared.ObservationTime{Time: time.Now().UTC()}, Truth: core.TruthTrue, Evidence: "fixture:event"}
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, e := svc.Evaluate(ctx, rule.Rule.ID, obs); errs <- e }()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	page, err := svc.ListEvents(ctx, application.EventQuery{RuleID: shared.Some(rule.Rule.ID), Limit: 10})
	if err != nil || len(page.Items) != 1 {
		t.Fatalf("events=%+v err=%v", page, err)
	}
	eventID := page.Items[0].Event.ID
	falseObs := obs
	falseObs.EventID = "exit"
	falseObs.Truth = core.TruthFalse
	falseObs.At.Time = obs.At.Time.Add(time.Second)
	if _, err := svc.Evaluate(ctx, rule.Rule.ID, falseObs); err != nil {
		t.Fatal(err)
	}
	trueObs := falseObs
	trueObs.EventID = "re-enter"
	trueObs.Truth = core.TruthTrue
	trueObs.At.Time = obs.At.Time.Add(2 * time.Second)
	if _, err := svc.Evaluate(ctx, rule.Rule.ID, trueObs); err != nil {
		t.Fatal(err)
	}
	page, err = svc.ListEvents(ctx, application.EventQuery{AircraftID: subject.AircraftID, Limit: 10})
	if err != nil || len(page.Items) != 2 {
		t.Fatalf("re-entry events=%+v err=%v", page, err)
	}
	acked, err := svc.Acknowledge(ctx, eventID)
	if err != nil || !acked.Acknowledged {
		t.Fatalf("ack=%+v err=%v", acked, err)
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
	svc = application.NewService(NewRepository(client.Database(name)), watchedScope{}, verifiedEvidence{})
	loaded, err := svc.ListEvents(ctx, application.EventQuery{RuleID: shared.Some(rule.Rule.ID), Limit: 10})
	if err != nil || len(loaded.Items) != 2 {
		t.Fatalf("reloaded=%+v err=%v", loaded, err)
	}
	foundAck := false
	for _, item := range loaded.Items {
		if item.Event.ID == eventID && item.Acknowledged {
			foundAck = true
		}
	}
	if !foundAck {
		t.Fatal("acknowledgement did not persist")
	}
	storedRule, err := svc.ListRules(ctx, "", 10)
	if err != nil || len(storedRule.Items) != 1 || storedRule.Items[0].Revision != 1 {
		t.Fatalf("rules=%+v err=%v", storedRule, err)
	}
}
