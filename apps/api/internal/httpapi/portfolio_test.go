package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/finsight-org/finsight/apps/api/internal/config"
	"github.com/finsight-org/finsight/apps/api/internal/localcontext"
	"github.com/finsight-org/finsight/apps/api/internal/portfolio"
)

func TestScopedPortfolioValueRoutesPassPortfolioID(t *testing.T) {
	portfolioID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	accountID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	tests := []struct {
		name    string
		path    string
		service fakePortfolioService
	}{
		{
			name:    "overview",
			path:    "/api/portfolios/" + portfolioID.String() + "/overview",
			service: fakePortfolioService{overview: portfolio.Overview{BaseCurrency: "CAD", TotalValue: decimal.RequireFromString("100.25"), ValuationDate: date("2026-07-07")}},
		},
		{
			name:    "value history",
			path:    "/api/portfolios/" + portfolioID.String() + "/value-history?range=1W",
			service: fakePortfolioService{history: portfolio.ValueHistory{BaseCurrency: "CAD", Range: portfolio.RangeOneWeek, Points: []portfolio.ValuePoint{{Date: date("2026-07-07"), Value: decimal.RequireFromString("100")}}}},
		},
		{
			name:    "account values",
			path:    "/api/portfolios/" + portfolioID.String() + "/account-values",
			service: fakePortfolioService{accountValues: portfolio.AccountValues{BaseCurrency: "CAD", ValuationDate: date("2026-07-07"), Accounts: []portfolio.AccountValue{{AccountID: accountID, AccountName: "TFSA", Value: decimal.RequireFromString("100"), AllocationPercent: decimal.RequireFromString("100")}}}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			service := tt.service
			router := newLocalPortfolioRouter(&service, &fakePortfolioLocalContext{})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, tt.path, nil))

			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
			}
			if service.portfolioID != portfolioID {
				t.Fatalf("portfolio id = %s, want %s", service.portfolioID, portfolioID)
			}
		})
	}
}

func TestScopedPortfolioValueRoutesRejectUnavailablePortfolio(t *testing.T) {
	portfolioID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	paths := []string{
		"/api/portfolios/" + portfolioID.String() + "/overview",
		"/api/portfolios/" + portfolioID.String() + "/value-history?range=1W",
		"/api/portfolios/" + portfolioID.String() + "/account-values",
	}

	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			service := &fakePortfolioService{err: portfolio.ErrInvalidRange}
			router := newLocalPortfolioRouter(service, &fakePortfolioLocalContext{ensureErr: localcontext.ErrPortfolioNotAllowed})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))

			if response.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
			}
			assertErrorCode(t, response, "portfolio_not_found")
			if service.calls != 0 {
				t.Fatalf("portfolio service calls = %d, want 0", service.calls)
			}
		})
	}
}

func TestPortfolioValueHistoryMissingRangeUsesGenericValidationError(t *testing.T) {
	portfolioID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	service := &fakePortfolioService{}
	router := newLocalPortfolioRouter(service, &fakePortfolioLocalContext{})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/portfolios/"+portfolioID.String()+"/value-history", nil))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	assertErrorCode(t, response, "invalid_request")
	if service.calls != 0 {
		t.Fatalf("portfolio service calls = %d, want 0", service.calls)
	}
}

func TestScopedPortfolioValueHistoryRejectsInvalidPortfolioIDAsInvalidRequest(t *testing.T) {
	service := &fakePortfolioService{}
	router := newLocalPortfolioRouter(service, &fakePortfolioLocalContext{})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/portfolios/not-a-uuid/value-history?range=1W", nil))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	assertErrorCode(t, response, "invalid_request")
	if service.calls != 0 {
		t.Fatalf("portfolio service calls = %d, want 0", service.calls)
	}
}

func TestScopedPortfolioValueRoutesRejectManagedModeBeforeLookup(t *testing.T) {
	portfolioID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	service := &fakePortfolioService{}
	localContext := &fakePortfolioLocalContext{}
	router := NewRouter(Options{DeploymentMode: config.DeploymentModeManaged, LocalContext: localContext, Portfolio: service})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/portfolios/"+portfolioID.String()+"/overview", nil))

	if response.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotImplemented)
	}
	assertErrorCode(t, response, "managed_identity_not_implemented")
	if localContext.ensureCalls != 0 {
		t.Fatalf("EnsurePortfolio() calls = %d, want 0", localContext.ensureCalls)
	}
}

func TestPortfolioValueHistoryServiceValidationUsesGenericError(t *testing.T) {
	portfolioID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	service := &fakePortfolioService{err: portfolio.ErrInvalidRange}
	router := newLocalPortfolioRouter(service, &fakePortfolioLocalContext{})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/portfolios/"+portfolioID.String()+"/value-history?range=1W", nil))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	assertErrorCode(t, response, "invalid_request")
}

func TestLegacyPortfolioValueRoutesAreNotRegistered(t *testing.T) {
	service := &fakePortfolioService{}
	router := newLocalPortfolioRouter(service, &fakePortfolioLocalContext{})

	for _, path := range []string{
		"/api/portfolio/overview",
		"/api/portfolio/value-history?range=1W",
		"/api/portfolio/account-values",
	} {
		t.Run(path, func(t *testing.T) {
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
			if response.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
			}
		})
	}
}

func TestPortfolioValueRouteReturnsNotFoundWhenPortfolioDisappears(t *testing.T) {
	portfolioID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	service := &fakePortfolioService{err: portfolio.ErrNotFound}
	router := newLocalPortfolioRouter(service, &fakePortfolioLocalContext{})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/portfolios/"+portfolioID.String()+"/overview", nil))

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
	assertErrorCode(t, response, "portfolio_not_found")
}

func TestPortfolioValueRouteUnexpectedError(t *testing.T) {
	portfolioID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	service := &fakePortfolioService{err: errors.New("boom")}
	router := newLocalPortfolioRouter(service, &fakePortfolioLocalContext{})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/portfolios/"+portfolioID.String()+"/overview", nil))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	assertErrorCode(t, response, "portfolio_operation_failed")
}

func newLocalPortfolioRouter(service PortfolioService, localContext LocalContextService) http.Handler {
	return NewRouter(Options{
		DeploymentMode: config.DeploymentModeLocal,
		LocalContext:   localContext,
		Portfolio:      service,
	})
}

type fakePortfolioService struct {
	overview      portfolio.Overview
	history       portfolio.ValueHistory
	accountValues portfolio.AccountValues
	err           error
	portfolioID   uuid.UUID
	calls         int
}

func (s *fakePortfolioService) GetOverview(_ context.Context, portfolioID uuid.UUID) (portfolio.Overview, error) {
	s.calls++
	s.portfolioID = portfolioID
	if s.err != nil {
		return portfolio.Overview{}, s.err
	}
	return s.overview, nil
}

func (s *fakePortfolioService) GetValueHistory(_ context.Context, portfolioID uuid.UUID, _ portfolio.Range) (portfolio.ValueHistory, error) {
	s.calls++
	s.portfolioID = portfolioID
	if s.err != nil {
		return portfolio.ValueHistory{}, s.err
	}
	return s.history, nil
}

func (s *fakePortfolioService) GetAccountValues(_ context.Context, portfolioID uuid.UUID) (portfolio.AccountValues, error) {
	s.calls++
	s.portfolioID = portfolioID
	if s.err != nil {
		return portfolio.AccountValues{}, s.err
	}
	return s.accountValues, nil
}

type fakePortfolioLocalContext struct {
	defaultPortfolioID uuid.UUID
	defaultErr         error
	ensureErr          error
	defaultCalls       int
	ensureCalls        int
}

func (s *fakePortfolioLocalContext) DefaultPortfolioID(context.Context) (uuid.UUID, error) {
	s.defaultCalls++
	return s.defaultPortfolioID, s.defaultErr
}

func (s *fakePortfolioLocalContext) EnsurePortfolio(context.Context, uuid.UUID) error {
	s.ensureCalls++
	return s.ensureErr
}

func date(value string) time.Time {
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		panic(err)
	}
	return parsed
}
