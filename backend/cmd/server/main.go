package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ppotepa/terminal-velocity/backend/internal/bootstrap"
	"github.com/ppotepa/terminal-velocity/backend/internal/platform/config"
	platformmongo "github.com/ppotepa/terminal-velocity/backend/internal/platform/mongo"
)

func main() {
	if err := run(); err != nil {
		log.Printf("server stopped: %v", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	rootCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	connectCtx, cancelConnect := context.WithTimeout(rootCtx, 10*time.Second)
	db, err := platformmongo.Connect(connectCtx, cfg.MongoURI, cfg.MongoDatabase, nil)
	cancelConnect()
	if err != nil {
		// Driver errors can include endpoint details. Do not log them because a URI
		// may contain credentials; the key name is enough to guide local setup.
		return errors.New("MongoDB connection failed; check TV_MONGODB_URI and local Mongo availability")
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := db.Disconnect(ctx); err != nil {
			log.Printf("MongoDB disconnect failed")
		}
	}()

	server := bootstrap.NewHTTPServer(cfg.HTTPAddr, cfg.Version, db)
	serveErr := make(chan error, 1)
	go func() {
		log.Printf("server listening on %s", cfg.HTTPAddr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
		}
		close(serveErr)
	}()

	select {
	case <-rootCtx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			_ = server.Close()
			return errors.New("HTTP server shutdown timed out")
		}
		return nil
	case err := <-serveErr:
		if err != nil {
			return errors.New("HTTP server failed to listen")
		}
		return nil
	}
}
