// Package config loads and validates the server's environment configuration.
package config

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
)

const (
	defaultHTTPAddr      = "127.0.0.1:8080"
	defaultMongoURI      = "mongodb://127.0.0.1:27017"
	defaultMongoDB       = "terminal_velocity"
	defaultServerVersion = "1.0.0"
)

// Config contains validated runtime settings. MongoURI must never be logged:
// MongoDB connection strings can contain credentials.
type Config struct {
	HTTPAddr      string
	MongoURI      string
	MongoDatabase string
	Version       string
}

// Load reads TV_* variables from the process environment and applies safe local defaults.
func Load() (Config, error) {
	return LoadFrom(os.Getenv)
}

// LoadFrom is the environment-reader variant of Load, suitable for deterministic tests.
func LoadFrom(getenv func(string) string) (Config, error) {
	cfg := Config{
		HTTPAddr:      valueOr(getenv("TV_HTTP_ADDR"), defaultHTTPAddr),
		MongoURI:      valueOr(getenv("TV_MONGODB_URI"), defaultMongoURI),
		MongoDatabase: valueOr(getenv("TV_MONGODB_DATABASE"), defaultMongoDB),
		Version:       defaultServerVersion,
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// Validate rejects malformed or externally bound server settings. This service is
// intentionally local-only; widening the bind address requires a later deployment decision.
func (c Config) Validate() error {
	host, portText, err := net.SplitHostPort(c.HTTPAddr)
	if err != nil {
		return fmt.Errorf("TV_HTTP_ADDR must be a host:port address")
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return fmt.Errorf("TV_HTTP_ADDR port must be between 1 and 65535")
	}
	ip := net.ParseIP(host)
	if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return fmt.Errorf("TV_HTTP_ADDR must bind to loopback (127.0.0.1 or localhost)")
	}
	u, err := url.Parse(c.MongoURI)
	if err != nil || (u.Scheme != "mongodb" && u.Scheme != "mongodb+srv") || u.Hostname() == "" {
		return fmt.Errorf("TV_MONGODB_URI must be a valid mongodb or mongodb+srv URI")
	}
	if strings.TrimSpace(c.MongoDatabase) == "" || strings.ContainsAny(c.MongoDatabase, "/\\.\" $<>:|?*") {
		return fmt.Errorf("TV_MONGODB_DATABASE must be a valid database name")
	}
	if strings.TrimSpace(c.Version) == "" {
		return fmt.Errorf("server version must not be empty")
	}
	return nil
}

func valueOr(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
