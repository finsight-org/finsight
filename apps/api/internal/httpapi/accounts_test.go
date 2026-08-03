package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/finsight-org/finsight/apps/api/internal/account"
	"github.com/finsight-org/finsight/apps/api/internal/config"
	"github.com/finsight-org/finsight/apps/api/internal/localcontext"
	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
)

func TestPostPortfolioAccount(t *testing.T) {
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	accountID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	accounts := &fakeAccountService{account: testAccount(accountID, portfolioID, "Margin")}
	router := newLocalAccountRouter(portfolioID, accounts, &fakeAccountLocalContext{})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/portfolios/"+portfolioID.String()+"/accounts", strings.NewReader(`{"name":"Margin","type":"BROKERAGE","base_currency":"CAD"}`))
	router.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusCreated)
	}
	if accounts.createPortfolioID != portfolioID {
		t.Fatalf("create portfolio id = %s, want %s", accounts.createPortfolioID, portfolioID)
	}
}

func TestGetPortfolioAccounts(t *testing.T) {
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	accounts := &fakeAccountService{accounts: []account.Account{
		testAccount(uuid.MustParse("55555555-5555-5555-5555-555555555555"), portfolioID, "Bank"),
		testAccount(uuid.MustParse("66666666-6666-6666-6666-666666666666"), portfolioID, "Brokerage"),
	}}
	router := newLocalAccountRouter(portfolioID, accounts, &fakeAccountLocalContext{})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/portfolios/"+portfolioID.String()+"/accounts", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if accounts.listPortfolioID != portfolioID {
		t.Fatalf("list portfolio id = %s, want %s", accounts.listPortfolioID, portfolioID)
	}
	var body generated.AccountListResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(body.Accounts) != 2 {
		t.Fatalf("accounts length = %d, want 2", len(body.Accounts))
	}
}

func TestGetPortfolioAccount(t *testing.T) {
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	accountID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	accounts := &fakeAccountService{account: testAccount(accountID, portfolioID, "Margin")}
	router := newLocalAccountRouter(portfolioID, accounts, &fakeAccountLocalContext{})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/portfolios/"+portfolioID.String()+"/accounts/"+accountID.String(), nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if accounts.getPortfolioID != portfolioID {
		t.Fatalf("get portfolio id = %s, want %s", accounts.getPortfolioID, portfolioID)
	}
	if accounts.getAccountID != accountID {
		t.Fatalf("get account id = %s, want %s", accounts.getAccountID, accountID)
	}
}

func TestPortfolioAccountRoutesRejectNonDefaultPortfolio(t *testing.T) {
	defaultPortfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	requestedPortfolioID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	accounts := &fakeAccountService{}
	localContext := &fakeAccountLocalContext{ensureErr: localcontext.ErrPortfolioNotAllowed}
	router := newLocalAccountRouter(defaultPortfolioID, accounts, localContext)

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/portfolios/"+requestedPortfolioID.String()+"/accounts", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
	assertErrorCode(t, response, "portfolio_not_found")
	if accounts.calls != 0 {
		t.Fatalf("account service calls = %d, want 0", accounts.calls)
	}
}

func TestPortfolioAccountRoutesReportMissingLocalContext(t *testing.T) {
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	accounts := &fakeAccountService{}
	router := newLocalAccountRouter(portfolioID, accounts, &fakeAccountLocalContext{ensureErr: localcontext.ErrNotFound})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/portfolios/"+portfolioID.String()+"/accounts", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
	assertErrorCode(t, response, "local_context_not_found")
	if accounts.calls != 0 {
		t.Fatalf("account service calls = %d, want 0", accounts.calls)
	}
}

func TestPortfolioAccountRoutesDoNotExposeLocalContextLookupFailure(t *testing.T) {
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	accounts := &fakeAccountService{}
	router := newLocalAccountRouter(portfolioID, accounts, &fakeAccountLocalContext{ensureErr: errors.New("database credentials")})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/portfolios/"+portfolioID.String()+"/accounts", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	if strings.Contains(response.Body.String(), "database credentials") {
		t.Fatal("response exposed local context lookup error")
	}
	assertErrorCode(t, response, "local_context_lookup_failed")
	if accounts.calls != 0 {
		t.Fatalf("account service calls = %d, want 0", accounts.calls)
	}
}

func TestPortfolioAccountRoutesRejectManagedModeBeforeLookup(t *testing.T) {
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	accounts := &fakeAccountService{}
	localContext := &fakeAccountLocalContext{}
	router := NewRouter(Options{
		DeploymentMode: config.DeploymentModeManaged,
		LocalContext:   localContext,
		Accounts:       accounts,
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/portfolios/"+portfolioID.String()+"/accounts", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotImplemented)
	}
	assertErrorCode(t, response, "managed_identity_not_implemented")
	if localContext.ensureCalls != 0 {
		t.Fatalf("EnsurePortfolio() calls = %d, want 0", localContext.ensureCalls)
	}
}

func TestGetAccountNotFound(t *testing.T) {
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	router := newLocalAccountRouter(portfolioID, &fakeAccountService{err: account.ErrNotFound}, &fakeAccountLocalContext{})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/portfolios/"+portfolioID.String()+"/accounts/55555555-5555-5555-5555-555555555555", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
	assertErrorCode(t, response, "account_not_found")
}

func TestPostPortfolioAccountInvalidBody(t *testing.T) {
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	router := newLocalAccountRouter(portfolioID, &fakeAccountService{}, &fakeAccountLocalContext{})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/portfolios/"+portfolioID.String()+"/accounts", strings.NewReader(`{"name":`))
	router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	assertErrorCode(t, response, "invalid_request")
}

func TestLegacyAccountRoutesAreNotRegistered(t *testing.T) {
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	router := newLocalAccountRouter(portfolioID, &fakeAccountService{}, &fakeAccountLocalContext{})

	for _, request := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/api/accounts"},
		{method: http.MethodGet, path: "/api/accounts"},
		{method: http.MethodGet, path: "/api/accounts/55555555-5555-5555-5555-555555555555"},
	} {
		t.Run(request.method+" "+request.path, func(t *testing.T) {
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(request.method, request.path, nil))
			if response.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
			}
		})
	}
}

func TestPortfolioAccountRoutesRejectInvalidPathIDs(t *testing.T) {
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	tests := []struct {
		name string
		path string
	}{
		{
			name: "list invalid portfolio id",
			path: "/api/portfolios/not-a-uuid/accounts",
		},
		{
			name: "get invalid account id",
			path: "/api/portfolios/" + portfolioID.String() + "/accounts/not-a-uuid",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			accounts := &fakeAccountService{}
			router := newLocalAccountRouter(portfolioID, accounts, &fakeAccountLocalContext{})

			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, tt.path, nil))

			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
			}
			assertErrorCode(t, response, "invalid_request")
			if accounts.calls != 0 {
				t.Fatalf("account service calls = %d, want 0", accounts.calls)
			}
		})
	}
}

func TestAccountValidationErrorMapping(t *testing.T) {
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	tests := []struct {
		name string
		err  error
		code string
	}{
		{name: "invalid name", err: account.ErrInvalidName, code: "invalid_account_name"},
		{name: "invalid type", err: account.ErrInvalidType, code: "invalid_account_type"},
		{name: "invalid currency", err: account.ErrInvalidCurrency, code: "invalid_base_currency"},
		{name: "unexpected", err: errors.New("boom"), code: "account_operation_failed"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := newLocalAccountRouter(portfolioID, &fakeAccountService{err: tt.err}, &fakeAccountLocalContext{})
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/portfolios/"+portfolioID.String()+"/accounts", strings.NewReader(`{"name":"Margin","type":"BROKERAGE","base_currency":"CAD"}`))
			router.ServeHTTP(response, request)
			assertErrorCode(t, response, tt.code)
		})
	}
}

func newLocalAccountRouter(portfolioID uuid.UUID, accounts AccountService, localContext *fakeAccountLocalContext) http.Handler {
	if localContext.defaultPortfolioID == uuid.Nil {
		localContext.defaultPortfolioID = portfolioID
	}
	return NewRouter(Options{
		DeploymentMode: config.DeploymentModeLocal,
		LocalContext:   localContext,
		Accounts:       accounts,
	})
}

type fakeAccountService struct {
	account  account.Account
	accounts []account.Account
	err      error

	createPortfolioID uuid.UUID
	listPortfolioID   uuid.UUID
	getPortfolioID    uuid.UUID
	getAccountID      uuid.UUID
	calls             int
}

func (s *fakeAccountService) CreateAccount(_ context.Context, portfolioID uuid.UUID, _ account.CreateInput) (account.Account, error) {
	s.calls++
	s.createPortfolioID = portfolioID
	return s.account, s.err
}

func (s *fakeAccountService) ListAccounts(_ context.Context, portfolioID uuid.UUID) ([]account.Account, error) {
	s.calls++
	s.listPortfolioID = portfolioID
	return s.accounts, s.err
}

func (s *fakeAccountService) GetAccount(_ context.Context, portfolioID uuid.UUID, accountID uuid.UUID) (account.Account, error) {
	s.calls++
	s.getPortfolioID = portfolioID
	s.getAccountID = accountID
	if s.err != nil {
		return account.Account{}, s.err
	}
	if s.account.ID != uuid.Nil {
		return s.account, nil
	}
	return testAccount(accountID, portfolioID, "Margin"), nil
}

type fakeAccountLocalContext struct {
	defaultPortfolioID uuid.UUID
	defaultErr         error
	ensureErr          error
	defaultCalls       int
	ensureCalls        int
}

func (s *fakeAccountLocalContext) DefaultPortfolioID(context.Context) (uuid.UUID, error) {
	s.defaultCalls++
	return s.defaultPortfolioID, s.defaultErr
}

func (s *fakeAccountLocalContext) EnsurePortfolio(_ context.Context, portfolioID uuid.UUID) error {
	s.ensureCalls++
	if s.ensureErr != nil {
		return s.ensureErr
	}
	if portfolioID != s.defaultPortfolioID {
		return localcontext.ErrPortfolioNotAllowed
	}
	return nil
}

func testAccount(id uuid.UUID, portfolioID uuid.UUID, name string) account.Account {
	now := time.Date(2026, 6, 25, 12, 0, 0, 0, time.UTC)
	return account.Account{
		ID:           id,
		PortfolioID:  portfolioID,
		Name:         name,
		Type:         account.TypeBrokerage,
		BaseCurrency: "CAD",
		CreatedAt:    now,
		UpdatedAt:    now,
	}
}

func assertErrorCode(t *testing.T, response *httptest.ResponseRecorder, code string) {
	t.Helper()
	var body generated.ErrorResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Error.Code != code {
		t.Fatalf("error code = %q, want %q", body.Error.Code, code)
	}
}
