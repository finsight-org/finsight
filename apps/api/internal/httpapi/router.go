package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/finsight-org/finsight/apps/api/internal/account"
	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
)

type DatabasePinger interface {
	Ping(context.Context) error
}

type LocalBootstrapper interface {
	BootstrapLocal(context.Context) (bootstrap.Result, error)
}

type AccountService interface {
	CreateAccount(context.Context, account.CreateInput) (account.Account, error)
	ListAccounts(context.Context) ([]account.Account, error)
	GetAccount(context.Context, uuid.UUID) (account.Account, error)
}

type Options struct {
	ServiceName  string
	Version      string
	ReadyTimeout time.Duration
	Database     DatabasePinger
	Bootstrap    LocalBootstrapper
	Accounts     AccountService
}

func NewRouter(options Options) http.Handler {
	handler := apiServer{
		serviceName:  options.ServiceName,
		version:      options.Version,
		readyTimeout: options.ReadyTimeout,
		database:     options.Database,
		bootstrap:    options.Bootstrap,
		accounts:     options.Accounts,
	}

	return generated.Handler(handler)
}
