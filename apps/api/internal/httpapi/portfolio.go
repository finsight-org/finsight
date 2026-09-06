package httpapi

import (
	"errors"
	"net/http"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
	"github.com/finsight-org/finsight/apps/api/internal/portfolio"
)

func (s apiServer) GetPortfolioOverviewByID(w http.ResponseWriter, r *http.Request, portfolioID openapi_types.UUID) {
	requestedPortfolioID := uuid.UUID(portfolioID)
	if err := s.ensureLocalPortfolio(r.Context(), requestedPortfolioID); err != nil {
		writeLocalContextError(w, err)
		return
	}
	s.getPortfolioOverview(w, r, requestedPortfolioID)
}

func (s apiServer) getPortfolioOverview(w http.ResponseWriter, r *http.Request, portfolioID uuid.UUID) {
	if s.portfolio == nil {
		writePortfolioError(w, http.StatusInternalServerError, "portfolio_unavailable", "portfolio service is unavailable")
		return
	}

	overview, err := s.portfolio.GetOverview(r.Context(), portfolioID)
	if err != nil {
		writePortfolioCalculatorError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, portfolioOverviewResponse(overview))
}

func (s apiServer) GetPortfolioValueHistoryByID(w http.ResponseWriter, r *http.Request, portfolioID openapi_types.UUID, params generated.GetPortfolioValueHistoryByIDParams) {
	requestedPortfolioID := uuid.UUID(portfolioID)
	if err := s.ensureLocalPortfolio(r.Context(), requestedPortfolioID); err != nil {
		writeLocalContextError(w, err)
		return
	}
	s.getPortfolioValueHistory(w, r, requestedPortfolioID, portfolio.Range(params.Range))
}

func (s apiServer) getPortfolioValueHistory(w http.ResponseWriter, r *http.Request, portfolioID uuid.UUID, valueRange portfolio.Range) {
	if s.portfolio == nil {
		writePortfolioError(w, http.StatusInternalServerError, "portfolio_unavailable", "portfolio service is unavailable")
		return
	}

	history, err := s.portfolio.GetValueHistory(r.Context(), portfolioID, valueRange)
	if err != nil {
		writePortfolioCalculatorError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, portfolioValueHistoryResponse(history))
}

func (s apiServer) GetPortfolioAccountValuesByID(w http.ResponseWriter, r *http.Request, portfolioID openapi_types.UUID) {
	requestedPortfolioID := uuid.UUID(portfolioID)
	if err := s.ensureLocalPortfolio(r.Context(), requestedPortfolioID); err != nil {
		writeLocalContextError(w, err)
		return
	}
	s.getPortfolioAccountValues(w, r, requestedPortfolioID)
}

func (s apiServer) getPortfolioAccountValues(w http.ResponseWriter, r *http.Request, portfolioID uuid.UUID) {
	if s.portfolio == nil {
		writePortfolioError(w, http.StatusInternalServerError, "portfolio_unavailable", "portfolio service is unavailable")
		return
	}

	values, err := s.portfolio.GetAccountValues(r.Context(), portfolioID)
	if err != nil {
		writePortfolioCalculatorError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, portfolioAccountValuesResponse(values))
}

func portfolioOverviewResponse(value portfolio.Overview) generated.PortfolioOverviewResponse {
	return generated.PortfolioOverviewResponse{
		BaseCurrency:  value.BaseCurrency,
		TotalValue:    decimalResponse(value.TotalValue),
		ValuationDate: openapiDate(value.ValuationDate),
		Warnings:      portfolioWarningsResponse(value.Warnings),
	}
}

func portfolioValueHistoryResponse(value portfolio.ValueHistory) generated.PortfolioValueHistoryResponse {
	points := make([]generated.PortfolioValuePoint, 0, len(value.Points))
	for _, point := range value.Points {
		points = append(points, generated.PortfolioValuePoint{
			Date:  openapiDate(point.Date),
			Value: decimalResponse(point.Value),
		})
	}
	return generated.PortfolioValueHistoryResponse{
		BaseCurrency: value.BaseCurrency,
		Range:        generated.PortfolioRange(value.Range),
		Points:       points,
		Warnings:     portfolioWarningsResponse(value.Warnings),
	}
}

func portfolioAccountValuesResponse(value portfolio.AccountValues) generated.PortfolioAccountValuesResponse {
	accounts := make([]generated.PortfolioAccountValue, 0, len(value.Accounts))
	for _, account := range value.Accounts {
		accounts = append(accounts, generated.PortfolioAccountValue{
			AccountId:         openapiUUID(account.AccountID),
			AccountName:       account.AccountName,
			Value:             decimalResponse(account.Value),
			AllocationPercent: decimalResponse(account.AllocationPercent),
		})
	}
	return generated.PortfolioAccountValuesResponse{
		BaseCurrency:  value.BaseCurrency,
		ValuationDate: openapiDate(value.ValuationDate),
		Accounts:      accounts,
		Warnings:      portfolioWarningsResponse(value.Warnings),
	}
}

func portfolioWarningsResponse(values []portfolio.Warning) []generated.PortfolioWarning {
	warnings := make([]generated.PortfolioWarning, 0, len(values))
	for _, value := range values {
		warnings = append(warnings, generated.PortfolioWarning{Code: value.Code, Message: value.Message})
	}
	return warnings
}

func writePortfolioCalculatorError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, portfolio.ErrInvalidRange):
		writeInvalidRequest(w)
	case errors.Is(err, portfolio.ErrNotFound):
		writePortfolioError(w, http.StatusNotFound, "portfolio_not_found", "portfolio was not found")
	default:
		writePortfolioError(w, http.StatusInternalServerError, "portfolio_operation_failed", "portfolio operation failed")
	}
}

func writePortfolioError(w http.ResponseWriter, status int, code string, message string) {
	writeJSON(w, status, generated.ErrorResponse{
		Error: generated.ErrorDetail{
			Code:    code,
			Message: message,
		},
	})
}
