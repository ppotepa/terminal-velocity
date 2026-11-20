// Package mongo provides the MongoDB connection boundary for platform adapters.
package mongo

import (
	"context"
	"errors"
	"time"

	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
)

// IndexRegistrar lets composition register shared indexes without coupling domain packages
// to MongoDB or adding migrations to the domain layer.
type IndexRegistrar func(context.Context, *driver.Database) error

// Client owns a connected driver client and its selected database.
type Client struct {
	client *driver.Client
	db     *driver.Database
}

// Connect establishes a MongoDB connection, verifies primary availability, and optionally
// registers application indexes before returning a usable client.
func Connect(ctx context.Context, uri, database string, register IndexRegistrar) (*Client, error) {
	client, err := driver.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		return nil, errors.New("could not create MongoDB client")
	}
	db := client.Database(database)
	connected := &Client{client: client, db: db}
	if err := client.Ping(ctx, readpref.Primary()); err != nil {
		disconnectCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Disconnect(disconnectCtx)
		return nil, errors.New("MongoDB connection check failed")
	}
	if register != nil {
		if err := register(ctx, db); err != nil {
			disconnectCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = client.Disconnect(disconnectCtx)
			return nil, errors.New("MongoDB index registration failed")
		}
	}
	return connected, nil
}

// Ping checks current connectivity. It is intended for the bounded health request.
func (c *Client) Ping(ctx context.Context) error {
	return c.client.Ping(ctx, readpref.Primary())
}

// Database returns the selected database for future repository adapters.
func (c *Client) Database() *driver.Database { return c.db }

// Disconnect closes the driver's pooled connections.
func (c *Client) Disconnect(ctx context.Context) error { return c.client.Disconnect(ctx) }
