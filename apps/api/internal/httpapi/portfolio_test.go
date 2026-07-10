package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
	"github.com/finsight-org/finsight/apps/api/internal/portfolio"
)

func TestGetPortfolioOverview(t *testing.T) {
	router := NewRouter(Options{Portfolio: fakePortfolioService{
		overview: portfolio.Overview{
			BaseCurrency:  "CAD",
			TotalValue:    decimal.RequireFromString("100.25"),
			ValuationDate: date("2026-07-07"),
		},
	}})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/portfolio/overview", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	var body generated.PortfolioOverviewResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.TotalValue != "100.250000000000" {
		t.Fatalf("total value = %q, want 100.250000000000", body.TotalValue)
	}
}

func TestGetPortfolioValueHistory(t *testing.T) {
	router := NewRouter(Options{Portfolio: fakePortfolioService{
		history: portfolio.ValueHistory{
			BaseCurrency: "CAD",
			Range:        portfolio.RangeOneWeek,
			Points:       []portfolio.ValuePoint{{Date: date("2026-07-07"), Value: decimal.RequireFromString("100")}},
		},
	}})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/portfolio/value-history?range=1W", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	var body generated.PortfolioValueHistoryResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Range != generated.N1W {
		t.Fatalf("range = %q, want 1W", body.Range)
	}
	if len(body.Points) != 1 {
		t.Fatalf("points length = %d, want 1", len(body.Points))
	}
}

func TestGetPortfolioValueHistoryInvalidRange(t *testing.T) {
	router := NewRouter(Options{Portfolio: fakePortfolioService{err: portfolio.ErrInvalidRange}})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/portfolio/value-history?range=BAD", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	assertErrorCode(t, response, "invalid_portfolio_range")
}

func TestGetPortfolioAccountValues(t *testing.T) {
	accountID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	router := NewRouter(Options{Portfolio: fakePortfolioService{
		accountValues: portfolio.AccountValues{
			BaseCurrency:  "CAD",
			ValuationDate: date("2026-07-07"),
			Accounts: []portfolio.AccountValue{{
				AccountID:         accountID,
				AccountName:       "TFSA",
				Value:             decimal.RequireFromString("100"),
				AllocationPercent: decimal.RequireFromString("100"),
			}},
		},
	}})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/portfolio/account-values", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	var body generated.PortfolioAccountValuesResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(body.Accounts) != 1 {
		t.Fatalf("accounts length = %d, want 1", len(body.Accounts))
	}
	if uuid.UUID(body.Accounts[0].AccountId) != accountID {
		t.Fatalf("account id = %s, want %s", uuid.UUID(body.Accounts[0].AccountId), accountID)
	}
}

func TestPortfolioUnexpectedError(t *testing.T) {
	router := NewRouter(Options{Portfolio: fakePortfolioService{err: errors.New("boom")}})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/portfolio/overview", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	assertErrorCode(t, response, "portfolio_operation_failed")
}

type fakePortfolioService struct {
	overview      portfolio.Overview
	history       portfolio.ValueHistory
	accountValues portfolio.AccountValues
	err           error
}

func (s fakePortfolioService) GetOverview(context.Context) (portfolio.Overview, error) {
	if s.err != nil {
		return portfolio.Overview{}, s.err
	}
	return s.overview, nil
}

func (s fakePortfolioService) GetValueHistory(context.Context, portfolio.Range) (portfolio.ValueHistory, error) {
	if s.err != nil {
		return portfolio.ValueHistory{}, s.err
	}
	return s.history, nil
}

func (s fakePortfolioService) GetAccountValues(context.Context) (portfolio.AccountValues, error) {
	if s.err != nil {
		return portfolio.AccountValues{}, s.err
	}
	return s.accountValues, nil
}

func date(value string) time.Time {
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		panic(err)
	}
	return parsed
}
