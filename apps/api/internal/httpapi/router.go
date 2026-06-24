package httpapi

import (
	"context"
	"net/http"
	"time"
)

type DatabasePinger interface {
	Ping(context.Context) error
}

type Options struct {
	ServiceName  string
	Version      string
	ReadyTimeout time.Duration
	Database     DatabasePinger
}

func NewRouter(options Options) http.Handler {
	handler := healthHandler{
		serviceName:  options.ServiceName,
		version:      options.Version,
		readyTimeout: options.ReadyTimeout,
		database:     options.Database,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handler.health)
	mux.HandleFunc("GET /ready", handler.ready)

	return mux
}
