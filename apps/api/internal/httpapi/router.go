package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"
	nethttpmiddleware "github.com/oapi-codegen/nethttp-middleware"

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
	Accounts       *account.Store
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

	generatedHandler := generated.HandlerWithOptions(handler, generated.StdHTTPServerOptions{
		ErrorHandlerFunc: generatedParameterError,
	})

	spec, err := generated.GetSwagger()
	if err != nil {
		panic("load embedded OpenAPI specification: " + err.Error())
	}

	return nethttpmiddleware.OapiRequestValidatorWithOptions(spec, &nethttpmiddleware.Options{
		ErrorHandlerWithOpts: openAPIValidationError,
	})(generatedHandler)
}

func generatedParameterError(w http.ResponseWriter, _ *http.Request, _ error) {
	writeInvalidRequest(w)
}

func openAPIValidationError(_ context.Context, _ error, w http.ResponseWriter, r *http.Request, options nethttpmiddleware.ErrorHandlerOpts) {
	if options.MatchedRoute == nil {
		http.NotFound(w, r)
		return
	}
	writeInvalidRequest(w)
}

func writeInvalidRequest(w http.ResponseWriter) {
	writeJSON(w, http.StatusBadRequest, generated.ErrorResponse{
		Error: generated.ErrorDetail{
			Code:    "invalid_request",
			Message: "request is invalid",
		},
	})
}
