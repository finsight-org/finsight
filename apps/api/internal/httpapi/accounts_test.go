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
	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
)

func TestPostAccount(t *testing.T) {
	accountID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	router := NewRouter(Options{
		ServiceName:  "finsight-api",
		Version:      "dev",
		ReadyTimeout: time.Second,
		Database:     fakePinger{},
		Accounts: fakeAccountService{
			account: testAccount(accountID, portfolioID, "Margin"),
		},
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/accounts", strings.NewReader(`{"name":"Margin","type":"BROKERAGE","base_currency":"CAD"}`))
	router.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusCreated)
	}
	var body generated.Account
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if uuid.UUID(body.Id) != accountID {
		t.Fatalf("id = %s, want %s", uuid.UUID(body.Id), accountID)
	}
}

func TestPostAccountConflict(t *testing.T) {
	router := NewRouter(Options{Accounts: fakeAccountService{err: account.ErrDuplicateName}})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/accounts", strings.NewReader(`{"name":"Margin","type":"BROKERAGE","base_currency":"CAD"}`))
	router.ServeHTTP(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
	}
	assertErrorCode(t, response, "account_name_conflict")
}

func TestPostAccountInvalidBody(t *testing.T) {
	router := NewRouter(Options{Accounts: fakeAccountService{}})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/accounts", strings.NewReader(`{"name":`))
	router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	assertErrorCode(t, response, "invalid_request")
}

func TestGetAccounts(t *testing.T) {
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	router := NewRouter(Options{
		Accounts: fakeAccountService{
			accounts: []account.Account{
				testAccount(uuid.MustParse("55555555-5555-5555-5555-555555555555"), portfolioID, "Bank"),
				testAccount(uuid.MustParse("66666666-6666-6666-6666-666666666666"), portfolioID, "Brokerage"),
			},
		},
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/accounts", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	var body generated.AccountListResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(body.Accounts) != 2 {
		t.Fatalf("accounts length = %d, want 2", len(body.Accounts))
	}
}

func TestGetAccountNotFound(t *testing.T) {
	router := NewRouter(Options{Accounts: fakeAccountService{err: account.ErrNotFound}})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/accounts/55555555-5555-5555-5555-555555555555", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
	assertErrorCode(t, response, "account_not_found")
}

func TestAccountValidationErrorMapping(t *testing.T) {
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
			router := NewRouter(Options{Accounts: fakeAccountService{err: tt.err}})
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/accounts", strings.NewReader(`{"name":"Margin","type":"BROKERAGE","base_currency":"CAD"}`))
			router.ServeHTTP(response, request)
			assertErrorCode(t, response, tt.code)
		})
	}
}

type fakeAccountService struct {
	account  account.Account
	accounts []account.Account
	err      error
}

func (s fakeAccountService) CreateAccount(context.Context, account.CreateInput) (account.Account, error) {
	return s.account, s.err
}

func (s fakeAccountService) ListAccounts(context.Context) ([]account.Account, error) {
	return s.accounts, s.err
}

func (s fakeAccountService) GetAccount(_ context.Context, id uuid.UUID) (account.Account, error) {
	if s.err != nil {
		return account.Account{}, s.err
	}
	if s.account.ID != uuid.Nil {
		return s.account, nil
	}
	return testAccount(id, uuid.MustParse("44444444-4444-4444-4444-444444444444"), "Margin"), nil
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
