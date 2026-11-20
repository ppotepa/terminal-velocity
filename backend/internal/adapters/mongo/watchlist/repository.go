// Package watchlist adapts the application WatchRule repository port to MongoDB.
package watchlist

import (
	"context"
	"errors"
	"time"

	application "github.com/ppotepa/terminal-velocity/backend/internal/application/watchlist"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/shared"
	"github.com/ppotepa/terminal-velocity/backend/internal/core/watch"
	"go.mongodb.org/mongo-driver/v2/bson"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const collectionName = "watch_rules"

type document struct {
	ID        string          `bson:"_id"`
	Version   int64           `bson:"version"`
	CreatedAt time.Time       `bson:"created_at"`
	UpdatedAt time.Time       `bson:"updated_at"`
	Rule      watch.WatchRule `bson:"rule"`
}

// Repository persists WatchRule aggregates and version metadata in one collection.
type Repository struct{ collection *driver.Collection }

func NewRepository(database *driver.Database) *Repository {
	return &Repository{collection: database.Collection(collectionName)}
}

// EnsureIndexes installs the status/order index used by bounded scheduler reads.
func (r *Repository) EnsureIndexes(ctx context.Context) error {
	_, err := r.collection.Indexes().CreateOne(ctx, driver.IndexModel{
		Keys:    bson.D{{Key: "rule.status", Value: 1}, {Key: "_id", Value: 1}},
		Options: options.Index().SetName("watch_rules_status_id"),
	})
	return err
}

func (r *Repository) Create(ctx context.Context, rule watch.WatchRule, now time.Time) (application.StoredRule, error) {
	item := application.StoredRule{Rule: rule, Version: 1, CreatedAt: now.UTC(), UpdatedAt: now.UTC()}
	_, err := r.collection.InsertOne(ctx, toDocument(item))
	if driver.IsDuplicateKeyError(err) {
		return application.StoredRule{}, application.ErrConflict
	}
	if err != nil {
		return application.StoredRule{}, err
	}
	return item, nil
}

func (r *Repository) Get(ctx context.Context, id shared.WatchRuleID) (application.StoredRule, error) {
	var doc document
	if err := r.collection.FindOne(ctx, bson.D{{Key: "_id", Value: string(id)}}).Decode(&doc); err != nil {
		return application.StoredRule{}, mapNotFound(err)
	}
	return fromDocument(doc), nil
}

func (r *Repository) Update(ctx context.Context, id shared.WatchRuleID, expectedVersion int64, rule watch.WatchRule, now time.Time) (application.StoredRule, error) {
	filter := bson.D{{Key: "_id", Value: string(id)}, {Key: "version", Value: expectedVersion}, {Key: "rule.status", Value: bson.D{{Key: "$ne", Value: watch.StatusDeleted}}}}
	update := bson.D{{Key: "$set", Value: bson.D{{Key: "rule", Value: rule}, {Key: "version", Value: expectedVersion + 1}, {Key: "updated_at", Value: now.UTC()}}}}
	var doc document
	err := r.collection.FindOneAndUpdate(ctx, filter, update, options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&doc)
	if errors.Is(err, driver.ErrNoDocuments) {
		return application.StoredRule{}, r.classifyMissingOrStale(ctx, id)
	}
	if err != nil {
		return application.StoredRule{}, err
	}
	return fromDocument(doc), nil
}

func (r *Repository) SetStatus(ctx context.Context, id shared.WatchRuleID, expectedVersion int64, status watch.Status, now time.Time) (application.StoredRule, error) {
	filter := bson.D{{Key: "_id", Value: string(id)}, {Key: "version", Value: expectedVersion}, {Key: "rule.status", Value: bson.D{{Key: "$ne", Value: watch.StatusDeleted}}}}
	update := bson.D{{Key: "$set", Value: bson.D{{Key: "rule.status", Value: status}, {Key: "version", Value: expectedVersion + 1}, {Key: "updated_at", Value: now.UTC()}}}}
	var doc document
	err := r.collection.FindOneAndUpdate(ctx, filter, update, options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&doc)
	if errors.Is(err, driver.ErrNoDocuments) {
		return application.StoredRule{}, r.classifyMissingOrStale(ctx, id)
	}
	if err != nil {
		return application.StoredRule{}, err
	}
	return fromDocument(doc), nil
}

func (r *Repository) Delete(ctx context.Context, id shared.WatchRuleID, expectedVersion int64) error {
	result, err := r.collection.DeleteOne(ctx, bson.D{{Key: "_id", Value: string(id)}, {Key: "version", Value: expectedVersion}})
	if err != nil {
		return err
	}
	if result.DeletedCount == 0 {
		return r.classifyMissingOrStale(ctx, id)
	}
	return nil
}

func (r *Repository) List(ctx context.Context, afterID string, limit int) ([]application.StoredRule, bool, error) {
	return r.list(ctx, bson.D{{Key: "_id", Value: bson.D{{Key: "$gt", Value: afterID}}}}, limit)
}

func (r *Repository) ListEnabled(ctx context.Context, afterID string, limit int) ([]application.StoredRule, bool, error) {
	filter := bson.D{{Key: "rule.status", Value: watch.StatusActive}, {Key: "_id", Value: bson.D{{Key: "$gt", Value: afterID}}}}
	return r.list(ctx, filter, limit)
}

func (r *Repository) list(ctx context.Context, filter bson.D, limit int) ([]application.StoredRule, bool, error) {
	if limit < 1 {
		return nil, false, nil
	}
	opts := options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}).SetLimit(int64(limit + 1))
	cursor, err := r.collection.Find(ctx, filter, opts)
	if err != nil {
		return nil, false, err
	}
	defer cursor.Close(ctx)
	documents := make([]document, 0, limit+1)
	for cursor.Next(ctx) {
		var doc document
		if err := cursor.Decode(&doc); err != nil {
			return nil, false, err
		}
		documents = append(documents, doc)
	}
	if err := cursor.Err(); err != nil {
		return nil, false, err
	}
	more := len(documents) > limit
	if more {
		documents = documents[:limit]
	}
	items := make([]application.StoredRule, 0, len(documents))
	for _, doc := range documents {
		items = append(items, fromDocument(doc))
	}
	return items, more, nil
}

func (r *Repository) classifyMissingOrStale(ctx context.Context, id shared.WatchRuleID) error {
	err := r.collection.FindOne(ctx, bson.D{{Key: "_id", Value: string(id)}}, options.FindOne().SetProjection(bson.D{{Key: "_id", Value: 1}})).Err()
	if errors.Is(err, driver.ErrNoDocuments) {
		return application.ErrNotFound
	}
	if err != nil {
		return err
	}
	return application.ErrVersionConflict
}

func mapNotFound(err error) error {
	if errors.Is(err, driver.ErrNoDocuments) {
		return application.ErrNotFound
	}
	return err
}

func toDocument(item application.StoredRule) document {
	return document{ID: string(item.Rule.ID), Version: item.Version, CreatedAt: item.CreatedAt.UTC(), UpdatedAt: item.UpdatedAt.UTC(), Rule: item.Rule}
}

func fromDocument(doc document) application.StoredRule {
	doc.Rule.ID = shared.WatchRuleID(doc.ID)
	return application.StoredRule{Rule: doc.Rule, Version: doc.Version, CreatedAt: doc.CreatedAt.UTC(), UpdatedAt: doc.UpdatedAt.UTC()}
}
