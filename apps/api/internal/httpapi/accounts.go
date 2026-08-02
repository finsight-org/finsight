package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/finsight-org/finsight/apps/api/internal/account"
	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
)

func (s apiServer) PostAccount(w http.ResponseWriter, r *http.Request) {
	portfolioID, err := s.localDefaultPortfolioID(r.Context())
	if err != nil {
		writeLocalContextError(w, err)
		return
	}
	s.postAccountForPortfolio(w, r, portfolioID)
}

func (s apiServer) PostPortfolioAccount(w http.ResponseWriter, r *http.Request, portfolioID openapi_types.UUID) {
	requestedPortfolioID := uuid.UUID(portfolioID)
	if err := s.ensureLocalPortfolio(r.Context(), requestedPortfolioID); err != nil {
		writeLocalContextError(w, err)
		return
	}
	s.postAccountForPortfolio(w, r, requestedPortfolioID)
}

func (s apiServer) postAccountForPortfolio(w http.ResponseWriter, r *http.Request, portfolioID uuid.UUID) {
	if s.accounts == nil {
		writeAccountError(w, http.StatusInternalServerError, "accounts_unavailable", "account service is unavailable")
		return
	}

	var request generated.PostAccountJSONRequestBody
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeAccountError(w, http.StatusBadRequest, "invalid_request", "request body is invalid")
		return
	}

	created, err := s.accounts.CreateAccount(r.Context(), portfolioID, account.CreateInput{
		Name:              request.Name,
		InstitutionName:   request.InstitutionName,
		Type:              account.Type(request.Type),
		BaseCurrency:      request.BaseCurrency,
		ExternalReference: request.ExternalReference,
	})
	if err != nil {
		writeAccountServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, accountResponse(created))
}

func (s apiServer) GetAccounts(w http.ResponseWriter, r *http.Request) {
	portfolioID, err := s.localDefaultPortfolioID(r.Context())
	if err != nil {
		writeLocalContextError(w, err)
		return
	}
	s.getAccountsForPortfolio(w, r, portfolioID)
}

func (s apiServer) GetPortfolioAccounts(w http.ResponseWriter, r *http.Request, portfolioID openapi_types.UUID) {
	requestedPortfolioID := uuid.UUID(portfolioID)
	if err := s.ensureLocalPortfolio(r.Context(), requestedPortfolioID); err != nil {
		writeLocalContextError(w, err)
		return
	}
	s.getAccountsForPortfolio(w, r, requestedPortfolioID)
}

func (s apiServer) getAccountsForPortfolio(w http.ResponseWriter, r *http.Request, portfolioID uuid.UUID) {
	if s.accounts == nil {
		writeAccountError(w, http.StatusInternalServerError, "accounts_unavailable", "account service is unavailable")
		return
	}

	accounts, err := s.accounts.ListAccounts(r.Context(), portfolioID)
	if err != nil {
		writeAccountServiceError(w, err)
		return
	}

	response := generated.AccountListResponse{Accounts: make([]generated.Account, 0, len(accounts))}
	for _, value := range accounts {
		response.Accounts = append(response.Accounts, accountResponse(value))
	}
	writeJSON(w, http.StatusOK, response)
}

func (s apiServer) GetAccount(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	portfolioID, err := s.localDefaultPortfolioID(r.Context())
	if err != nil {
		writeLocalContextError(w, err)
		return
	}
	s.getAccountForPortfolio(w, r, portfolioID, uuid.UUID(id))
}

func (s apiServer) GetPortfolioAccount(w http.ResponseWriter, r *http.Request, portfolioID openapi_types.UUID, accountID openapi_types.UUID) {
	requestedPortfolioID := uuid.UUID(portfolioID)
	if err := s.ensureLocalPortfolio(r.Context(), requestedPortfolioID); err != nil {
		writeLocalContextError(w, err)
		return
	}
	s.getAccountForPortfolio(w, r, requestedPortfolioID, uuid.UUID(accountID))
}

func (s apiServer) getAccountForPortfolio(w http.ResponseWriter, r *http.Request, portfolioID uuid.UUID, accountID uuid.UUID) {
	if s.accounts == nil {
		writeAccountError(w, http.StatusInternalServerError, "accounts_unavailable", "account service is unavailable")
		return
	}

	found, err := s.accounts.GetAccount(r.Context(), portfolioID, accountID)
	if err != nil {
		writeAccountServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, accountResponse(found))
}

func accountResponse(value account.Account) generated.Account {
	return generated.Account{
		Id:                openapiUUID(value.ID),
		PortfolioId:       openapiUUID(value.PortfolioID),
		Name:              value.Name,
		InstitutionName:   value.InstitutionName,
		Type:              generated.AccountType(value.Type),
		BaseCurrency:      value.BaseCurrency,
		ExternalReference: value.ExternalReference,
		CreatedAt:         value.CreatedAt,
		UpdatedAt:         value.UpdatedAt,
	}
}

func writeAccountServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, account.ErrInvalidName):
		writeAccountError(w, http.StatusBadRequest, "invalid_account_name", "account name is required")
	case errors.Is(err, account.ErrInvalidType):
		writeAccountError(w, http.StatusBadRequest, "invalid_account_type", "account type is invalid")
	case errors.Is(err, account.ErrInvalidCurrency):
		writeAccountError(w, http.StatusBadRequest, "invalid_base_currency", "account base currency must be an uppercase 3-letter code")
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
