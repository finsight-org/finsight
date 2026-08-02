package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/google/uuid"

	"github.com/finsight-org/finsight/apps/api/internal/config"
	"github.com/finsight-org/finsight/apps/api/internal/localcontext"
	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
)

const (
	localContextLookupFailedCode    = "local_context_lookup_failed"
	localContextLookupFailedMessage = "local default portfolio lookup failed"
)

var (
	errManagedIdentityNotImplemented = errors.New("managed deployment identity is not implemented")
	errUnsupportedDeploymentMode     = errors.New("unsupported deployment mode")
	errLocalContextUnavailable       = errors.New("local context service is unavailable")
)

func (s apiServer) localDefaultPortfolioID(ctx context.Context) (uuid.UUID, error) {
	localContext, err := s.localContextService()
	if err != nil {
		return uuid.Nil, err
	}
	return localContext.DefaultPortfolioID(ctx)
}

func (s apiServer) ensureLocalPortfolio(ctx context.Context, portfolioID uuid.UUID) error {
	localContext, err := s.localContextService()
	if err != nil {
		return err
	}
	return localContext.EnsurePortfolio(ctx, portfolioID)
}

func (s apiServer) localContextService() (LocalContextService, error) {
	if s.deploymentMode == config.DeploymentModeManaged {
		return nil, errManagedIdentityNotImplemented
	}
	if s.deploymentMode != config.DeploymentModeLocal {
		return nil, fmt.Errorf("%w: %q", errUnsupportedDeploymentMode, s.deploymentMode)
	}
	if s.localContext == nil {
		return nil, errLocalContextUnavailable
	}
	return s.localContext, nil
}

func writeLocalContextError(w http.ResponseWriter, err error) {
	status, code, message := localContextErrorResponse(err)
	writeJSON(w, status, generated.ErrorResponse{
		Error: generated.ErrorDetail{Code: code, Message: message},
	})
}

func localContextErrorResponse(err error) (int, string, string) {
	switch {
	case errors.Is(err, errManagedIdentityNotImplemented):
		return http.StatusNotImplemented, "managed_identity_not_implemented", "managed deployment identity is not implemented"
	case errors.Is(err, errUnsupportedDeploymentMode):
		return http.StatusInternalServerError, "unsupported_deployment_mode", "current context is available only in local deployment mode"
	case errors.Is(err, errLocalContextUnavailable):
		return http.StatusInternalServerError, "local_context_unavailable", "local context service is unavailable"
	case errors.Is(err, localcontext.ErrNotFound):
		return http.StatusNotFound, "local_context_not_found", "local default portfolio was not found"
	case errors.Is(err, localcontext.ErrPortfolioNotAllowed):
		return http.StatusNotFound, "portfolio_not_found", "portfolio was not found"
	default:
		return http.StatusInternalServerError, localContextLookupFailedCode, localContextLookupFailedMessage
	}
}
