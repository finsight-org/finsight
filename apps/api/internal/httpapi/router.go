package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/finsight-org/finsight/apps/api/internal/account"
	"github.com/finsight-org/finsight/apps/api/internal/asset"
	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
	"github.com/finsight-org/finsight/apps/api/internal/portfolio"
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

type AssetFinder interface {
	SearchAssets(context.Context, asset.SearchInput) ([]asset.AssetCandidate, error)
}

type PortfolioService interface {
	GetOverview(context.Context) (portfolio.Overview, error)
	GetValueHistory(context.Context, portfolio.Range) (portfolio.ValueHistory, error)
	GetAccountValues(context.Context) (portfolio.AccountValues, error)
}

type Options struct {
	ServiceName  string
	Version      string
	ReadyTimeout time.Duration
	Database     DatabasePinger
	Bootstrap    LocalBootstrapper
	Accounts     AccountService
	Assets       AssetFinder
	Portfolio    PortfolioService
}

func NewRouter(options Options) http.Handler {
	handler := apiServer{
		serviceName:  options.ServiceName,
		version:      options.Version,
		readyTimeout: options.ReadyTimeout,
		database:     options.Database,
		bootstrap:    options.Bootstrap,
		accounts:     options.Accounts,
		assets:       options.Assets,
		portfolio:    options.Portfolio,
	}

	return generated.HandlerWithOptions(handler, generated.StdHTTPServerOptions{
		ErrorHandlerFunc: generatedParameterError,
	})
}

func generatedParameterError(w http.ResponseWriter, r *http.Request, _ error) {
	if r.URL.Path == "/api/assets/search" {
		writeAssetError(w, http.StatusBadRequest, "invalid_asset_search_query", "asset search query is invalid")
		return
	}
	if r.URL.Path == "/api/portfolio/value-history" {
		writePortfolioError(w, http.StatusBadRequest, "invalid_portfolio_range", "portfolio range is invalid")
		return
	}

	writeJSON(w, http.StatusBadRequest, generated.ErrorResponse{
		Error: generated.ErrorDetail{
			Code:    "invalid_request",
			Message: "request parameters are invalid",
		},
	})
}
