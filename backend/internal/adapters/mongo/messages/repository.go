// Package messages stores immutable message facts and source-scoped delivery identity.
package messages

import (
	"context"
	"crypto/sha256"
	"encoding/hex"

	application "github.com/ppotepa/terminal-velocity/backend/internal/application/messages"
	"go.mongodb.org/mongo-driver/v2/bson"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const collectionName = "aircraft_messages"

type document struct {
	ID     string             `bson:"_id"`
	Record application.Record `bson:"record"`
}
type Repository struct{ collection *driver.Collection }

func NewRepository(db *driver.Database) *Repository {
	return &Repository{collection: db.Collection(collectionName)}
}
func (r *Repository) EnsureIndexes(ctx context.Context) error {
	models := []driver.IndexModel{
		{Keys: bson.D{{Key: "record.identity.source", Value: 1}, {Key: "record.identity.key", Value: 1}}, Options: options.Index().SetUnique(true).SetName("message_source_identity")},
		{Keys: bson.D{{Key: "record.association.aircraft_id.value", Value: 1}, {Key: "record.sort_at", Value: -1}, {Key: "record.message.id", Value: -1}}, Options: options.Index().SetName("messages_aircraft_history")},
		{Keys: bson.D{{Key: "record.association.flight_id.value", Value: 1}, {Key: "record.sort_at", Value: -1}, {Key: "record.message.id", Value: -1}}, Options: options.Index().SetName("messages_flight_history")},
		{Keys: bson.D{{Key: "record.watch_rule_ids", Value: 1}, {Key: "record.sort_at", Value: -1}, {Key: "record.message.id", Value: -1}}, Options: options.Index().SetName("messages_watch_history")},
	}
	_, err := r.collection.Indexes().CreateMany(ctx, models)
	return err
}
func key(source, key string) string {
	sum := sha256.Sum256([]byte(source + "\x00" + key))
	return "msg_" + hex.EncodeToString(sum[:])
}
func (r *Repository) Insert(ctx context.Context, record application.Record) (application.Record, bool, error) {
	doc := document{ID: key(string(record.Identity.Source), record.Identity.Key), Record: record}
	_, err := r.collection.InsertOne(ctx, doc)
	if err == nil {
		return record, true, nil
	}
	if !driver.IsDuplicateKeyError(err) {
		return application.Record{}, false, err
	}
	var existing document
	if e := r.collection.FindOne(ctx, bson.D{{Key: "_id", Value: doc.ID}}).Decode(&existing); e != nil {
		return application.Record{}, false, e
	}
	if existing.Record.Identity.Source != record.Identity.Source || existing.Record.Identity.Key != record.Identity.Key {
		return application.Record{}, false, application.ErrConflict
	}
	if existing.Record.PayloadDigest != record.PayloadDigest {
		return application.Record{}, false, application.ErrConflict
	}
	return existing.Record, false, nil
}
func (r *Repository) List(ctx context.Context, q application.Query) ([]application.Record, bool, error) {
	filters := bson.A{}
	if q.AircraftID.Valid {
		filters = append(filters, bson.D{{Key: "record.association.aircraft_id.value", Value: string(q.AircraftID.Value)}})
	}
	if q.FlightID.Valid {
		filters = append(filters, bson.D{{Key: "record.association.flight_id.value", Value: string(q.FlightID.Value)}})
	}
	if q.WatchRuleID.Valid {
		filters = append(filters, bson.D{{Key: "record.watch_rule_ids", Value: string(q.WatchRuleID.Value)}})
	}
	if len(filters) == 0 {
		return nil, false, application.ErrInvalidQuery
	}
	var filter any
	if len(filters) == 1 {
		filter = filters[0]
	} else {
		filter = bson.D{{Key: "$or", Value: filters}}
	}
	sortSpec := bson.D{{Key: "record.sort_at", Value: -1}, {Key: "record.message.id", Value: -1}}
	if q.After.Valid {
		cursor := q.After.Value
		cursorFilter := bson.D{{Key: "$or", Value: bson.A{bson.D{{Key: "record.sort_at", Value: bson.D{{Key: "$lt", Value: cursor.SortAt}}}}, bson.D{{Key: "record.sort_at", Value: cursor.SortAt}, {Key: "record.message.id", Value: bson.D{{Key: "$lt", Value: cursor.ID}}}}}}}
		filter = bson.D{{Key: "$and", Value: bson.A{filter, cursorFilter}}}
	}
	cur, err := r.collection.Find(ctx, filter, options.Find().SetSort(sortSpec).SetLimit(int64(q.Limit+1)))
	if err != nil {
		return nil, false, err
	}
	defer cur.Close(ctx)
	docs := []document{}
	for cur.Next(ctx) {
		var d document
		if err := cur.Decode(&d); err != nil {
			return nil, false, err
		}
		docs = append(docs, d)
	}
	if err := cur.Err(); err != nil {
		return nil, false, err
	}
	more := len(docs) > q.Limit
	if more {
		docs = docs[:q.Limit]
	}
	out := make([]application.Record, 0, len(docs))
	for _, d := range docs {
		out = append(out, d.Record)
	}
	return out, more, nil
}

var _ application.Repository = (*Repository)(nil)
