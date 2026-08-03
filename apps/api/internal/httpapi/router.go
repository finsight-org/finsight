package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/finsight-org/finsight/apps/api/internal/account"
	"github.com/finsight-org/finsight/apps/api/internal/asset"
	"github.com/finsight-org/finsight/apps/api/internal/config"
	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
	"github.com/finsight-org/finsight/apps/api/internal/portfolio"
)

type DatabasePinger interface {
	Ping(context.Context) error
}

type LocalContextService interface {
	DefaultPortfolioID(context.Context) (uuid.UUID, error)
	EnsurePortfolio(context.Context, uuid.UUID) error
}

type AccountService interface {
	CreateAccount(context.Context, uuid.UUID, account.CreateInput) (account.Account, error)
	ListAccounts(context.Context, uuid.UUID) ([]account.Account, error)
	GetAccount(context.Context, uuid.UUID, uuid.UUID) (account.Account, error)
}

type AssetFinder interface {
	SearchAssets(context.Context, asset.SearchInput) ([]asset.AssetCandidate, error)
}

type PortfolioService interface {
	GetOverview(context.Context, uuid.UUID) (portfolio.Overview, error)
	GetValueHistory(context.Context, uuid.UUID, portfolio.Range) (portfolio.ValueHistory, error)
	GetAccountValues(context.Context, uuid.UUID) (portfolio.AccountValues, error)
}

type Options struct {
	ServiceName    string
	Version        string
	ReadyTimeout   time.Duration
	DeploymentMode config.DeploymentMode
	Database       DatabasePinger
	LocalContext   LocalContextService
	Accounts       AccountService
	Assets         AssetFinder
	Portfolio      PortfolioService
}

func NewRouter(options Options) http.Handler {
	handler := apiServer{
		serviceName:    options.ServiceName,
		version:        options.Version,
		readyTimeout:   options.ReadyTimeout,
		deploymentMode: options.DeploymentMode,
		database:       options.Database,
		localContext:   options.LocalContext,
		accounts:       options.Accounts,
		assets:         options.Assets,
		portfolio:      options.Portfolio,
	}

	return generated.HandlerWithOptions(handler, generated.StdHTTPServerOptions{
		ErrorHandlerFunc: generatedParameterError,
	})
}

func generatedParameterError(w http.ResponseWriter, r *http.Request, err error) {
	if r.URL.Path == "/api/assets/search" {
		writeAssetError(w, http.StatusBadRequest, "invalid_asset_search_query", "asset search query is invalid")
		return
	}
	if strings.HasSuffix(r.URL.Path, "/value-history") && isPortfolioRangeParameterError(err) {
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

func isPortfolioRangeParameterError(err error) bool {
	var requiredParameterError *generated.RequiredParamError
	if errors.As(err, &requiredParameterError) {
		return requiredParameterError.ParamName == "range"
	}

	var invalidParameterError *generated.InvalidParamFormatError
	return errors.As(err, &invalidParameterError) && invalidParameterError.ParamName == "range"
}
