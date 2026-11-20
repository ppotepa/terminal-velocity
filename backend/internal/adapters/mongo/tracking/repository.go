// Package tracking stores immutable observations and monotonic aircraft projections in MongoDB.
package tracking

import (
	"context"
	"errors"
	"strconv"
	"time"

	application "github.com/ppotepa/terminal-velocity/backend/internal/application/tracking"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"go.mongodb.org/mongo-driver/v2/bson"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const (
	observationsCollection = "position_observations"
	currentCollection      = "aircraft_current_positions"
)

type Repository struct{ observations, current *driver.Collection }

func NewRepository(database *driver.Database) *Repository {
	return &Repository{observations: database.Collection(observationsCollection), current: database.Collection(currentCollection)}
}

type geoPoint struct {
	Type        string    `bson:"type"`
	Coordinates []float64 `bson:"coordinates"`
}
type observationDocument struct {
	ID                  string                           `bson:"_id"`
	Source              string                           `bson:"source"`
	SourceObservationID string                           `bson:"source_observation_id"`
	AircraftID          shared.AircraftID                `bson:"aircraft_id"`
	FlightID            shared.Optional[shared.FlightID] `bson:"flight_id,omitempty"`
	ObservedAt          time.Time                        `bson:"observed_at"`
	ReceivedAt          time.Time                        `bson:"received_at"`
	QualityRank         int                              `bson:"quality_rank"`
	Observation         application.StoredObservation    `bson:"stored"`
	Location            geoPoint                         `bson:"location"`
}
type currentDocument struct {
	ID      string                        `bson:"_id"`
	Version int64                         `bson:"version"`
	Stored  application.StoredObservation `bson:"stored"`
}

func (r *Repository) EnsureIndexes(ctx context.Context) error {
	indexes := []driver.IndexModel{
		{Keys: bson.D{{Key: "source", Value: 1}, {Key: "source_observation_id", Value: 1}}, Options: options.Index().SetName("position_source_observation_unique").SetUnique(true)},
		{Keys: bson.D{{Key: "aircraft_id", Value: 1}, {Key: "observed_at", Value: -1}}, Options: options.Index().SetName("position_aircraft_event_time")},
		{Keys: bson.D{{Key: "stored.flight_id.value", Value: 1}, {Key: "observed_at", Value: 1}}, Options: options.Index().SetName("position_flight_event_time")},
		{Keys: bson.D{{Key: "location", Value: "2dsphere"}}, Options: options.Index().SetName("position_location_2dsphere")},
	}
	_, err := r.observations.Indexes().CreateMany(ctx, indexes)
	if err != nil {
		return err
	}
	_, err = r.current.Indexes().CreateOne(ctx, driver.IndexModel{Keys: bson.D{{Key: "stored.observation.observed_at.time", Value: -1}}, Options: options.Index().SetName("current_event_time")})
	return err
}

func (r *Repository) InsertObservation(ctx context.Context, item application.StoredObservation) (bool, error) {
	doc := toObservation(item)
	_, err := r.observations.InsertOne(ctx, doc)
	if err == nil {
		return true, nil
	}
	if !driver.IsDuplicateKeyError(err) {
		return false, err
	}
	var existing observationDocument
	if findErr := r.observations.FindOne(ctx, bson.D{{Key: "source", Value: string(item.Observation.Source)}, {Key: "source_observation_id", Value: item.Observation.SourceObservationID}}).Decode(&existing); findErr != nil {
		return false, findErr
	}
	if !sameStored(existing.Observation, item) {
		return false, application.ErrObservationConflict
	}
	return false, nil
}

func sameStored(a, b application.StoredObservation) bool {
	return a.AircraftID == b.AircraftID && a.FlightID == b.FlightID &&
		a.QualityRank == b.QualityRank &&
		a.Observation.Source == b.Observation.Source && a.Observation.SourceObservationID == b.Observation.SourceObservationID &&
		a.Observation.ObservedAt == b.Observation.ObservedAt && a.Observation.Latitude == b.Observation.Latitude &&
		a.Observation.Longitude == b.Observation.Longitude && a.Observation.AltitudeMeters == b.Observation.AltitudeMeters &&
		a.Observation.GroundSpeedMPS == b.Observation.GroundSpeedMPS && a.Observation.HeadingDegrees == b.Observation.HeadingDegrees
}

// ApplyCurrent uses a versioned compare-and-swap loop so concurrent late packets
// cannot overwrite a newer event-time/quality/source winner.
func (r *Repository) ApplyCurrent(ctx context.Context, item application.StoredObservation) (application.CurrentPosition, bool, error) {
	for attempts := 0; attempts < 12; attempts++ {
		var doc currentDocument
		err := r.current.FindOne(ctx, bson.D{{Key: "_id", Value: string(item.AircraftID)}}).Decode(&doc)
		if errors.Is(err, driver.ErrNoDocuments) {
			candidate := currentDocument{ID: string(item.AircraftID), Version: 1, Stored: item}
			if _, err = r.current.InsertOne(ctx, candidate); err == nil {
				return application.CurrentPosition{StoredObservation: item, Version: 1}, true, nil
			}
			if driver.IsDuplicateKeyError(err) {
				continue
			}
			return application.CurrentPosition{}, false, err
		}
		if err != nil {
			return application.CurrentPosition{}, false, err
		}
		if compare(item, doc.Stored) <= 0 {
			return application.CurrentPosition{StoredObservation: doc.Stored, Version: doc.Version}, false, nil
		}
		filter := bson.D{{Key: "_id", Value: doc.ID}, {Key: "version", Value: doc.Version}}
		update := bson.D{{Key: "$set", Value: bson.D{{Key: "stored", Value: item}, {Key: "version", Value: doc.Version + 1}}}}
		result, err := r.current.UpdateOne(ctx, filter, update)
		if err != nil {
			return application.CurrentPosition{}, false, err
		}
		if result.ModifiedCount == 1 {
			return application.CurrentPosition{StoredObservation: item, Version: doc.Version + 1}, true, nil
		}
	}
	return application.CurrentPosition{}, false, errors.New("current position update exceeded contention retry limit")
}

func (r *Repository) GetCurrent(ctx context.Context, id shared.AircraftID) (application.CurrentPosition, error) {
	var doc currentDocument
	err := r.current.FindOne(ctx, bson.D{{Key: "_id", Value: string(id)}}).Decode(&doc)
	if err != nil {
		return application.CurrentPosition{}, err
	}
	return application.CurrentPosition{StoredObservation: doc.Stored, Version: doc.Version}, nil
}

func (r *Repository) ListFlightPositions(ctx context.Context, id shared.FlightID, from, to time.Time, viewport *application.Viewport, limit int) ([]application.StoredObservation, bool, error) {
	filter := bson.D{{Key: "stored.flight_id.value", Value: id}, {Key: "observed_at", Value: bson.D{{Key: "$gte", Value: from}, {Key: "$lte", Value: to}}}}
	if viewport != nil {
		filter = append(filter, bson.E{Key: "location", Value: bson.D{{Key: "$geoWithin", Value: bson.D{{Key: "$geometry", Value: bson.D{{Key: "type", Value: "Polygon"}, {Key: "coordinates", Value: [][][]float64{{{viewport.MinLongitude, viewport.MinLatitude}, {viewport.MaxLongitude, viewport.MinLatitude}, {viewport.MaxLongitude, viewport.MaxLatitude}, {viewport.MinLongitude, viewport.MaxLatitude}, {viewport.MinLongitude, viewport.MinLatitude}}}}}}}}}})
	}
	cur, err := r.observations.Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "observed_at", Value: 1}, {Key: "source", Value: 1}, {Key: "source_observation_id", Value: 1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, false, err
	}
	defer cur.Close(ctx)
	items := make([]application.StoredObservation, 0, limit)
	for cur.Next(ctx) {
		var doc observationDocument
		if err := cur.Decode(&doc); err != nil {
			return nil, false, err
		}
		items = append(items, doc.Observation)
	}
	if err := cur.Err(); err != nil {
		return nil, false, err
	}
	return items, len(items) >= limit, nil
}

func toObservation(item application.StoredObservation) observationDocument {
	source := string(item.Observation.Source)
	return observationDocument{ID: strconv.Itoa(len(source)) + ":" + source + item.Observation.SourceObservationID, Source: source, SourceObservationID: item.Observation.SourceObservationID, AircraftID: item.AircraftID, FlightID: item.FlightID, ObservedAt: item.Observation.ObservedAt.Time.UTC(), ReceivedAt: item.ReceivedAt.UTC(), QualityRank: item.QualityRank, Observation: item, Location: geoPoint{Type: "Point", Coordinates: []float64{item.Observation.Longitude, item.Observation.Latitude}}}
}

func compare(a, b application.StoredObservation) int {
	ta, tb := a.Observation.ObservedAt.Time, b.Observation.ObservedAt.Time
	if ta.After(tb) {
		return 1
	}
	if ta.Before(tb) {
		return -1
	}
	if a.QualityRank > b.QualityRank {
		return 1
	}
	if a.QualityRank < b.QualityRank {
		return -1
	}
	if a.Observation.Source > b.Observation.Source {
		return 1
	}
	if a.Observation.Source < b.Observation.Source {
		return -1
	}
	if a.Observation.SourceObservationID > b.Observation.SourceObservationID {
		return 1
	}
	if a.Observation.SourceObservationID < b.Observation.SourceObservationID {
		return -1
	}
	return 0
}
