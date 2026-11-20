package config

import (
	"strings"
	"testing"
)

func TestLoadUsesLoopbackDefaults(t *testing.T) {
	cfg, err := LoadFrom(func(string) string { return "" })
	if err != nil {
		t.Fatal(err)
	}
	if cfg.HTTPAddr != "127.0.0.1:8080" || cfg.MongoDatabase != "terminal_velocity" {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
}

func TestValidateRejectsNonLoopbackBind(t *testing.T) {
	cfg := Config{HTTPAddr: "0.0.0.0:8080", MongoURI: defaultMongoURI, MongoDatabase: defaultMongoDB, Version: defaultServerVersion}
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "loopback") {
		t.Fatalf("expected loopback validation error, got %v", err)
	}
}

func TestInvalidMongoURIErrorDoesNotEchoValue(t *testing.T) {
	secretURI := "mongodb://user:password@"
	_, err := LoadFrom(func(key string) string {
		if key == "TV_MONGODB_URI" {
			return secretURI
		}
		return ""
	})
	if err == nil || strings.Contains(err.Error(), "password") {
		t.Fatalf("expected redacted Mongo URI validation error, got %v", err)
	}
}
