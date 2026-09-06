package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/finsight-org/finsight/apps/api/internal/account"
	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
	database "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
	"github.com/finsight-org/finsight/apps/api/internal/postgres/pgconv"
)

func (s apiServer) PostPortfolioAccount(w http.ResponseWriter, r *http.Request, portfolioID openapi_types.UUID) {
	requestedPortfolioID := uuid.UUID(portfolioID)
	if err := s.ensureLocalPortfolio(r.Context(), requestedPortfolioID); err != nil {
		writeLocalContextError(w, err)
		return
	}

	var request generated.PostPortfolioAccountJSONRequestBody
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		slog.Error("failed to deserialize account request body", "error", err, "method", r.Method, "path", r.URL.Path)
		writeAccountError(w, http.StatusBadRequest, "invalid_request", "request body is invalid")
		return
	}

	created, err := s.accounts.Create(r.Context(), account.CreateParams{
		PortfolioID:       requestedPortfolioID,
		Name:              request.Name,
		InstitutionName:   request.InstitutionName,
		Type:              string(request.Type),
		BaseCurrency:      request.BaseCurrency,
		ExternalReference: request.ExternalReference,
	})
	if err != nil {
		writeAccountStoreError(w, err)
		return
	}

	response, err := accountResponse(created)
	if err != nil {
		writeAccountStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

func (s apiServer) GetPortfolioAccounts(w http.ResponseWriter, r *http.Request, portfolioID openapi_types.UUID) {
	requestedPortfolioID := uuid.UUID(portfolioID)
	if err := s.ensureLocalPortfolio(r.Context(), requestedPortfolioID); err != nil {
		writeLocalContextError(w, err)
		return
	}

	accounts, err := s.accounts.List(r.Context(), requestedPortfolioID)
	if err != nil {
		writeAccountStoreError(w, err)
		return
	}

	response := generated.AccountListResponse{Accounts: make([]generated.Account, 0, len(accounts))}
	for _, value := range accounts {
		mapped, err := accountResponse(value)
		if err != nil {
			writeAccountStoreError(w, err)
			return
		}
		response.Accounts = append(response.Accounts, mapped)
	}
	writeJSON(w, http.StatusOK, response)
}

func (s apiServer) GetPortfolioAccount(w http.ResponseWriter, r *http.Request, portfolioID openapi_types.UUID, accountID openapi_types.UUID) {
	requestedPortfolioID := uuid.UUID(portfolioID)
	if err := s.ensureLocalPortfolio(r.Context(), requestedPortfolioID); err != nil {
		writeLocalContextError(w, err)
		return
	}

	found, err := s.accounts.Get(r.Context(), requestedPortfolioID, uuid.UUID(accountID))
	if err != nil {
		writeAccountStoreError(w, err)
		return
	}

	response, err := accountResponse(found)
	if err != nil {
		writeAccountStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func accountResponse(value database.Account) (generated.Account, error) {
	id, err := pgconv.DomainUUID(value.ID)
	if err != nil {
		return generated.Account{}, fmt.Errorf("map account id: %w", err)
	}
	portfolioID, err := pgconv.DomainUUID(value.PortfolioID)
	if err != nil {
		return generated.Account{}, fmt.Errorf("map account portfolio id: %w", err)
	}
	createdAt, err := pgconv.Time(value.CreatedAt)
	if err != nil {
		return generated.Account{}, fmt.Errorf("map account created at: %w", err)
	}
	updatedAt, err := pgconv.Time(value.UpdatedAt)
	if err != nil {
		return generated.Account{}, fmt.Errorf("map account updated at: %w", err)
	}
	return generated.Account{
		Id:                openapiUUID(id),
		PortfolioId:       openapiUUID(portfolioID),
		Name:              value.Name,
		InstitutionName:   pgconv.StringPointer(value.InstitutionName),
		Type:              generated.AccountType(value.Type),
		BaseCurrency:      value.BaseCurrency,
		ExternalReference: pgconv.StringPointer(value.ExternalReference),
		CreatedAt:         createdAt,
		UpdatedAt:         updatedAt,
	}, nil
}

func writeAccountStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, account.ErrInvalidInput):
		writeInvalidRequest(w)
	case errors.Is(err, account.ErrDuplicateName):
		writeAccountError(w, http.StatusConflict, "account_name_conflict", "account name already exists in the default portfolio")
	case errors.Is(err, account.ErrNotFound):
		writeAccountError(w, http.StatusNotFound, "account_not_found", "account was not found")
	default:
		writeAccountError(w, http.StatusInternalServerError, "account_operation_failed", "account operation failed")
	}
}

func writeAccountError(w http.ResponseWriter, status int, code string, message string) {
	writeJSON(w, status, generated.ErrorResponse{
		Error: generated.ErrorDetail{
			Code:    code,
			Message: message,
		},
	})
}
