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

	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/config"
	"github.com/finsight-org/finsight/apps/api/internal/localcontext"
	"github.com/finsight-org/finsight/apps/api/internal/portfolio"
	"github.com/finsight-org/finsight/apps/api/internal/portfoliovalue"
	database "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
)

func TestPortfolioHTTPFlowWithPostgres(t *testing.T) {
	pool := httpAccountTestPool(t)
	ctx := context.Background()
	if err := bootstrap.New(pool).BootstrapLocal(ctx); err != nil {
		t.Fatalf("BootstrapLocal() error = %v", err)
	}
	queries := database.New(pool)
	resolver := localcontext.New(queries)
	portfolioID, err := resolver.DefaultPortfolioID(ctx)
	if err != nil {
		t.Fatalf("DefaultPortfolioID() error = %v", err)
	}
	router := NewRouter(Options{
		DeploymentMode: config.DeploymentModeLocal,
		LocalContext:   resolver,
		Portfolio:      portfoliovalue.New(queries),
	})

	paths := []string{
		"/api/portfolios/" + portfolioID.String() + "/overview",
		"/api/portfolios/" + portfolioID.String() + "/value-history?range=1W",
		"/api/portfolios/" + portfolioID.String() + "/account-values",
	}
	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
			}
		})
	}
}

func TestPortfolioHTTPRejectsNonDefaultPortfolio(t *testing.T) {
	pool := httpAccountTestPool(t)
	ctx := context.Background()
	if err := bootstrap.New(pool).BootstrapLocal(ctx); err != nil {
		t.Fatalf("BootstrapLocal() error = %v", err)
	}
	queries := database.New(pool)
	resolver := localcontext.New(queries)
	scope, err := resolver.DefaultScope(ctx)
	if err != nil {
		t.Fatalf("DefaultScope() error = %v", err)
	}
	otherPortfolioID := insertHTTPTestPortfolio(t, ctx, pool, scope.WorkspaceID)
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `delete from portfolios where id = $1`, otherPortfolioID); err != nil {
			t.Fatalf("delete HTTP test portfolio: %v", err)
		}
	})
	router := NewRouter(Options{
		DeploymentMode: config.DeploymentModeLocal,
		LocalContext:   resolver,
		Portfolio:      portfoliovalue.New(queries),
	})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/portfolios/"+otherPortfolioID.String()+"/overview", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
	assertErrorCode(t, response, "portfolio_not_found")
}

func TestPortfolioOpenAPIValidationRunsFirst(t *testing.T) {
	paths := []string{
		"/api/portfolios/not-a-uuid/value-history?range=1W",
		"/api/portfolios/" + uuid.NewString() + "/value-history",
	}
	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			response := httptest.NewRecorder()
			NewRouter(Options{DeploymentMode: config.DeploymentModeLocal}).ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
			}
			assertErrorCode(t, response, "invalid_request")
		})
	}
}

func TestPortfolioErrorMapping(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{name: "invalid range", err: portfolio.ErrInvalidRange, status: http.StatusBadRequest, code: "invalid_request"},
		{name: "not found", err: portfolio.ErrNotFound, status: http.StatusNotFound, code: "portfolio_not_found"},
		{name: "unexpected", err: errors.New("boom"), status: http.StatusInternalServerError, code: "portfolio_operation_failed"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			writePortfolioCalculatorError(response, test.err)
			if response.Code != test.status {
				t.Fatalf("status = %d, want %d", response.Code, test.status)
			}
			assertErrorCode(t, response, test.code)
		})
	}
}

func TestPortfolioResponseMapping(t *testing.T) {
	accountID := uuid.New()
	date := portfolioTestDate("2026-07-07")
	overview := portfolioOverviewResponse(portfolio.Overview{BaseCurrency: "CAD", TotalValue: decimal.RequireFromString("100.25"), ValuationDate: date})
	if overview.BaseCurrency != "CAD" || overview.TotalValue != "100.250000000000" || overview.ValuationDate.Time != date {
		t.Fatalf("overview response = %#v", overview)
	}
	values := portfolioAccountValuesResponse(portfolio.AccountValues{
		BaseCurrency:  "CAD",
		ValuationDate: date,
		Accounts:      []portfolio.AccountValue{{AccountID: accountID, AccountName: "TFSA", Value: decimal.NewFromInt(100), AllocationPercent: decimal.NewFromInt(100)}},
	})
	if len(values.Accounts) != 1 || uuid.UUID(values.Accounts[0].AccountId) != accountID || values.Accounts[0].Value != "100.000000000000" {
		t.Fatalf("account values response = %#v", values)
	}
}

func TestLegacyPortfolioRoutesAreNotRegistered(t *testing.T) {
	for _, path := range []string{"/api/portfolio/overview", "/api/portfolio/value-history?range=1W", "/api/portfolio/account-values"} {
		response := httptest.NewRecorder()
		NewRouter(Options{}).ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s status = %d, want %d", path, response.Code, http.StatusNotFound)
		}
	}
}

func TestPortfolioRoutesRejectManagedMode(t *testing.T) {
	response := httptest.NewRecorder()
	path := "/api/portfolios/" + uuid.NewString() + "/overview"
	NewRouter(Options{DeploymentMode: config.DeploymentModeManaged}).ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
	if response.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotImplemented)
	}
	assertErrorCode(t, response, "managed_identity_not_implemented")
}

func portfolioTestDate(value string) time.Time {
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		panic(err)
	}
	return parsed
}
