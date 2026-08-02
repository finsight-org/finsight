package httpapi

import (
	"errors"
	"net/http"

	"github.com/finsight-org/finsight/apps/api/internal/config"
	"github.com/finsight-org/finsight/apps/api/internal/localcontext"
	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
)

const (
	localContextLookupFailedCode    = "local_context_lookup_failed"
	localContextLookupFailedMessage = "local default portfolio lookup failed"
)

func (s apiServer) GetMe(w http.ResponseWriter, r *http.Request) {
	if s.deploymentMode == config.DeploymentModeManaged {
		writeMeError(w, http.StatusNotImplemented, "managed_identity_not_implemented", "managed deployment identity is not implemented")
		return
	}
	if s.deploymentMode != config.DeploymentModeLocal {
		writeMeError(w, http.StatusInternalServerError, "unsupported_deployment_mode", "current context is available only in local deployment mode")
		return
	}
	if s.localContext == nil {
		writeMeError(w, http.StatusInternalServerError, "local_context_unavailable", "local context service is unavailable")
		return
	}

	portfolioID, err := s.localContext.DefaultPortfolioID(r.Context())
	if err != nil {
		if errors.Is(err, localcontext.ErrNotFound) {
			writeMeError(w, http.StatusNotFound, "local_context_not_found", "local default portfolio was not found")
			return
		}
		writeLocalContextLookupFailure(w)
		return
	}

	writeJSON(w, http.StatusOK, generated.MeResponse{DefaultPortfolioId: openapiUUID(portfolioID)})
}

func writeLocalContextLookupFailure(w http.ResponseWriter) {
	writeMeError(w, http.StatusInternalServerError, localContextLookupFailedCode, localContextLookupFailedMessage)
}

func writeMeError(w http.ResponseWriter, status int, code string, message string) {
	writeJSON(w, status, generated.ErrorResponse{
		Error: generated.ErrorDetail{Code: code, Message: message},
	})
}
