package httpapi

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func (s apiServer) PostLocalBootstrap(w http.ResponseWriter, r *http.Request) {
	if s.bootstrap == nil {
		writeBootstrapError(w, http.StatusInternalServerError, "bootstrap_unavailable", "local bootstrap service is unavailable")
		return
	}

	result, err := s.bootstrap.BootstrapLocal(r.Context())
	if err != nil {
		writeBootstrapError(w, http.StatusInternalServerError, "bootstrap_failed", "local bootstrap failed")
		return
	}

	response := localBootstrapResponse(result)

	status := http.StatusOK
	if result.Created {
		status = http.StatusCreated
	}
	writeJSON(w, status, response)
}

func writeBootstrapError(w http.ResponseWriter, status int, code string, message string) {
	writeJSON(w, status, generated.ErrorResponse{
		Error: generated.ErrorDetail{
			Code:    code,
			Message: message,
		},
	})
}

func localBootstrapResponse(value bootstrap.Result) generated.LocalBootstrapResponse {
	return generated.LocalBootstrapResponse{
		Created: value.Created,
		User: generated.BootstrapUser{
			Id:          openapiUUID(value.User.ID),
			Email:       openapi_types.Email(value.User.Email),
			DisplayName: value.User.DisplayName,
		},
		Workspace: generated.BootstrapWorkspace{
			Id:           openapiUUID(value.Workspace.ID),
			Name:         value.Workspace.Name,
			BaseCurrency: value.Workspace.BaseCurrency,
			AuthMode:     value.Workspace.AuthMode,
		},
		Membership: generated.BootstrapWorkspaceMembership{
			Id:          openapiUUID(value.Membership.ID),
			WorkspaceId: openapiUUID(value.Membership.WorkspaceID),
			UserId:      openapiUUID(value.Membership.UserID),
			Role:        value.Membership.Role,
		},
		Portfolio: generated.BootstrapPortfolio{
			Id:           openapiUUID(value.Portfolio.ID),
			WorkspaceId:  openapiUUID(value.Portfolio.WorkspaceID),
			Name:         value.Portfolio.Name,
			BaseCurrency: value.Portfolio.BaseCurrency,
			IsDefault:    value.Portfolio.IsDefault,
		},
	}
}

func openapiUUID(value uuid.UUID) openapi_types.UUID {
	return openapi_types.UUID(value)
}
