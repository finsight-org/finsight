package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
)

type DatabasePinger interface {
	Ping(context.Context) error
}

type LocalBootstrapper interface {
	BootstrapLocal(context.Context) (bootstrap.Result, error)
}

type Options struct {
	ServiceName  string
	Version      string
	ReadyTimeout time.Duration
	Database     DatabasePinger
	Bootstrap    LocalBootstrapper
}

func NewRouter(options Options) http.Handler {
	handler := apiServer{
		serviceName:  options.ServiceName,
		version:      options.Version,
		readyTimeout: options.ReadyTimeout,
		database:     options.Database,
		bootstrap:    options.Bootstrap,
	}

	return generated.Handler(handler)
}
