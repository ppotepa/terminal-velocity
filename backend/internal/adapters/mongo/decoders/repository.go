// Package decoders persists versioned decoder configurations and immutable results.
package decoders

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	application "github.com/ppotepa/terminal-velocity/backend/internal/application/decoding"
	core "github.com/ppotepa/terminal-velocity/backend/internal/core/decoding"
	"go.mongodb.org/mongo-driver/v2/bson"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const (
	configCollection = "decoder_configs"
	resultCollection = "message_decode_results"
)

type configDoc struct {
	ID        string             `bson:"_id"`
	Config    core.DecoderConfig `bson:"config"`
	Revision  int64              `bson:"revision"`
	UpdatedAt time.Time          `bson:"updated_at"`
}
type resultDoc struct {
	ID             string                   `bson:"_id"`
	MessageID      string                   `bson:"message_id"`
	DecoderID      string                   `bson:"decoder_id"`
	ConfigRevision int64                    `bson:"config_revision"`
	DecoderVersion string                   `bson:"decoder_version"`
	Record         application.StoredResult `bson:"record"`
}
type Repository struct{ configs, results *driver.Collection }

func NewRepository(db *driver.Database) *Repository {
	return &Repository{configs: db.Collection(configCollection), results: db.Collection(resultCollection)}
}
func (r *Repository) EnsureIndexes(ctx context.Context) error {
	if _, err := r.configs.Indexes().CreateOne(ctx, driver.IndexModel{Keys: bson.D{{Key: "revision", Value: 1}}, Options: options.Index().SetName("decoder_config_revision")}); err != nil {
		return err
	}
	_, err := r.results.Indexes().CreateMany(ctx, []driver.IndexModel{{Keys: bson.D{{Key: "message_id", Value: 1}, {Key: "decoder_id", Value: 1}, {Key: "config_revision", Value: 1}, {Key: "decoder_version", Value: 1}}, Options: options.Index().SetUnique(true).SetName("decode_message_decoder_revision")}, {Keys: bson.D{{Key: "message_id", Value: 1}, {Key: "_id", Value: 1}}, Options: options.Index().SetName("decode_message_history")}})
	return err
}
func (r *Repository) GetConfig(ctx context.Context, id core.DecoderID) (application.StoredConfig, error) {
	var d configDoc
	err := r.configs.FindOne(ctx, bson.D{{Key: "_id", Value: string(id)}}).Decode(&d)
	if errors.Is(err, driver.ErrNoDocuments) {
		return application.StoredConfig{}, application.ErrNotFound
	}
	if err != nil {
		return application.StoredConfig{}, err
	}
	return application.StoredConfig{Config: d.Config, Revision: d.Revision, UpdatedAt: d.UpdatedAt.UTC()}, nil
}
func (r *Repository) SaveConfig(ctx context.Context, cfg core.DecoderConfig, expected int64, now time.Time) (application.StoredConfig, error) {
	if expected == 0 {
		doc := configDoc{ID: string(cfg.DecoderID), Config: cfg, Revision: 1, UpdatedAt: now.UTC()}
		_, err := r.configs.InsertOne(ctx, doc)
		if driver.IsDuplicateKeyError(err) {
			return application.StoredConfig{}, application.ErrConflict
		}
		if err != nil {
			return application.StoredConfig{}, err
		}
		return application.StoredConfig{Config: cfg, Revision: 1, UpdatedAt: doc.UpdatedAt}, nil
	}
	filter := bson.D{{Key: "_id", Value: string(cfg.DecoderID)}, {Key: "revision", Value: expected}}
	update := bson.D{{Key: "$set", Value: bson.D{{Key: "config", Value: cfg}, {Key: "revision", Value: expected + 1}, {Key: "updated_at", Value: now.UTC()}}}}
	var d configDoc
	err := r.configs.FindOneAndUpdate(ctx, filter, update, options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&d)
	if errors.Is(err, driver.ErrNoDocuments) {
		var exists configDoc
		e := r.configs.FindOne(ctx, bson.D{{Key: "_id", Value: string(cfg.DecoderID)}}).Decode(&exists)
		if errors.Is(e, driver.ErrNoDocuments) {
			return application.StoredConfig{}, application.ErrNotFound
		}
		if e != nil {
			return application.StoredConfig{}, e
		}
		return application.StoredConfig{}, application.ErrConflict
	}
	if err != nil {
		return application.StoredConfig{}, err
	}
	return application.StoredConfig{Config: d.Config, Revision: d.Revision, UpdatedAt: d.UpdatedAt.UTC()}, nil
}
func resultID(v application.StoredResult) string {
	raw := fmt.Sprintf("%s\x00%s\x00%d\x00%s", v.MessageID, v.Result.DecoderID, v.ConfigRevision, v.Result.DecoderVersion)
	sum := sha256.Sum256([]byte(raw))
	return "decode_" + hex.EncodeToString(sum[:])
}
func (r *Repository) SaveResult(ctx context.Context, v application.StoredResult) (application.StoredResult, error) {
	doc := resultDoc{ID: resultID(v), MessageID: string(v.MessageID), DecoderID: string(v.Result.DecoderID), ConfigRevision: v.ConfigRevision, DecoderVersion: v.Result.DecoderVersion, Record: v}
	_, err := r.results.InsertOne(ctx, doc)
	if err == nil {
		return v, nil
	}
	if !driver.IsDuplicateKeyError(err) {
		return application.StoredResult{}, err
	}
	var old resultDoc
	if e := r.results.FindOne(ctx, bson.D{{Key: "_id", Value: doc.ID}}).Decode(&old); e != nil {
		return application.StoredResult{}, e
	}
	return old.Record, nil
}
func (r *Repository) ListResults(ctx context.Context, q application.ResultQuery) ([]application.StoredResult, bool, error) {
	filter := bson.D{{Key: "message_id", Value: string(q.MessageID)}}
	if q.After != "" {
		filter = bson.D{{Key: "message_id", Value: string(q.MessageID)}, {Key: "_id", Value: bson.D{{Key: "$gt", Value: q.After}}}}
	}
	cur, err := r.results.Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}).SetLimit(int64(q.Limit+1)))
	if err != nil {
		return nil, false, err
	}
	defer cur.Close(ctx)
	docs := []resultDoc{}
	for cur.Next(ctx) {
		var d resultDoc
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
	out := make([]application.StoredResult, 0, len(docs))
	for _, d := range docs {
		out = append(out, d.Record)
	}
	return out, more, nil
}

var _ application.ConfigRepository = (*Repository)(nil)
var _ application.ResultRepository = (*Repository)(nil)
