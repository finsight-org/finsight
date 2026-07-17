package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/finsight-org/finsight/apps/api/internal/asset"
	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
	"github.com/finsight-org/finsight/apps/api/internal/transaction"
)

func TestPostAccountTransaction(t *testing.T) {
	accountID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	service := &fakeTransactionService{transaction: testAccountTransaction(accountID)}
	router := NewRouter(Options{Transactions: service})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/accounts/"+accountID.String()+"/transactions", strings.NewReader(`{
		"type":"BUY",
		"trade_date":"2026-07-08",
		"description":"Buy CRCL",
		"currency":"CAD",
		"asset":{"name":"Circle","symbol":"CRCL","asset_type":"EQUITY","currency":"CAD","provider_id":"yahoo","provider_symbol":"crcl"},
		"quantity":"2",
		"price":"10",
		"fees":"1.25"
	}`))
	router.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusCreated)
	}
	if service.createInput.AccountID != accountID || service.createInput.Type != transaction.TypeBuy {
		t.Fatalf("create input = %+v", service.createInput)
	}
	if service.createInput.Quantity == nil || !service.createInput.Quantity.Equal(decimal.NewFromInt(2)) {
		t.Fatalf("quantity = %v, want 2", service.createInput.Quantity)
	}
	var body generated.AccountTransaction
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !body.Editable {
		t.Fatal("editable = false, want true")
	}
}

func TestPostAccountTransactionRejectsOversizedDecimal(t *testing.T) {
	accountID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	service := &fakeTransactionService{}
	router := NewRouter(Options{Transactions: service})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/accounts/"+accountID.String()+"/transactions", strings.NewReader(`{
		"type":"DEPOSIT",
		"trade_date":"2026-07-08",
		"description":"Deposit",
		"currency":"CAD",
		"amount":"1234567890123456789012345678901234567890"
	}`))
	router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	assertErrorCode(t, response, "invalid_transaction_amount")
	if service.createCalled {
		t.Fatal("transaction service was called for an invalid decimal")
	}
}

func TestListAccountTransactionsPreservesZeroCashImpact(t *testing.T) {
	accountID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	value := testAccountTransaction(accountID)
	zero := decimal.Zero
	value.CashImpact = &zero
	value.Editable = false
	router := NewRouter(Options{Transactions: &fakeTransactionService{transactions: []transaction.AccountTransaction{value}}})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/accounts/"+accountID.String()+"/transactions", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	var body generated.AccountTransactionListResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(body.Transactions) != 1 || body.Transactions[0].CashImpact == nil || *body.Transactions[0].CashImpact != "0.000000000000" {
		t.Fatalf("transactions = %+v, want explicit zero cash impact", body.Transactions)
	}
	if body.Transactions[0].Editable {
		t.Fatal("editable = true, want false")
	}
}

func TestPutAccountTransactionMapsImportedConflict(t *testing.T) {
	accountID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	transactionID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	router := NewRouter(Options{Transactions: &fakeTransactionService{err: transaction.ErrImportedMutation}})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/accounts/"+accountID.String()+"/transactions/"+transactionID.String(), strings.NewReader(`{
		"type":"DEPOSIT","trade_date":"2026-07-08","description":"Deposit","currency":"CAD","amount":"100"
	}`))
	router.ServeHTTP(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
	}
	assertErrorCode(t, response, "imported_transaction_read_only")
}

func TestPutAccountTransactionMapsUnsupportedTypeConflict(t *testing.T) {
	accountID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	transactionID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	router := NewRouter(Options{Transactions: &fakeTransactionService{err: transaction.ErrUnsupportedMutation}})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/accounts/"+accountID.String()+"/transactions/"+transactionID.String(), strings.NewReader(`{
		"type":"DEPOSIT","trade_date":"2026-07-08","description":"Deposit","currency":"CAD","amount":"100"
	}`))
	router.ServeHTTP(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
	}
	assertErrorCode(t, response, "transaction_type_read_only")
}

func TestDeleteAccountTransactionMapsNotFound(t *testing.T) {
	accountID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	transactionID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	router := NewRouter(Options{Transactions: &fakeTransactionService{err: transaction.ErrNotFound}})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodDelete, "/api/accounts/"+accountID.String()+"/transactions/"+transactionID.String(), nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
	assertErrorCode(t, response, "transaction_not_found")
}

func TestGetAccountDerivedViews(t *testing.T) {
	accountID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	stock := asset.Asset{ID: uuid.New(), Name: "Circle", Symbol: "CRCL", Type: asset.TypeEquity, Currency: "CAD", ProviderID: "yahoo", ProviderSymbol: "crcl"}
	service := &fakeTransactionService{
		positions:    []transaction.Position{{Asset: stock, Quantity: decimal.NewFromInt(2), Currency: "CAD"}},
		cashBalances: []transaction.CashBalance{{Currency: "CAD", Balance: decimal.RequireFromString("12.50")}},
	}
	router := NewRouter(Options{Transactions: service})

	positionResponse := httptest.NewRecorder()
	router.ServeHTTP(positionResponse, httptest.NewRequest(http.MethodGet, "/api/accounts/"+accountID.String()+"/positions", nil))
	if positionResponse.Code != http.StatusOK {
		t.Fatalf("positions status = %d, want %d", positionResponse.Code, http.StatusOK)
	}
	var positions generated.AccountPositionsResponse
	if err := json.NewDecoder(positionResponse.Body).Decode(&positions); err != nil {
		t.Fatalf("decode positions: %v", err)
	}
	if len(positions.Positions) != 1 || positions.Positions[0].Quantity != "2.000000000000" {
		t.Fatalf("positions = %+v", positions.Positions)
	}

	cashResponse := httptest.NewRecorder()
	router.ServeHTTP(cashResponse, httptest.NewRequest(http.MethodGet, "/api/accounts/"+accountID.String()+"/cash-balances", nil))
	if cashResponse.Code != http.StatusOK {
		t.Fatalf("cash status = %d, want %d", cashResponse.Code, http.StatusOK)
	}
	var cash generated.AccountCashBalancesResponse
	if err := json.NewDecoder(cashResponse.Body).Decode(&cash); err != nil {
		t.Fatalf("decode cash balances: %v", err)
	}
	if len(cash.CashBalances) != 1 || cash.CashBalances[0].Balance != "12.500000000000" {
		t.Fatalf("cash balances = %+v", cash.CashBalances)
	}
}

type fakeTransactionService struct {
	transaction  transaction.AccountTransaction
	transactions []transaction.AccountTransaction
	positions    []transaction.Position
	cashBalances []transaction.CashBalance
	createInput  transaction.GuidedInput
	createCalled bool
	err          error
}

func (s *fakeTransactionService) ListAccountTransactions(context.Context, uuid.UUID) ([]transaction.AccountTransaction, error) {
	return s.transactions, s.err
}

func (s *fakeTransactionService) RecordAccountTransaction(_ context.Context, input transaction.GuidedInput) (transaction.AccountTransaction, error) {
	s.createCalled = true
	s.createInput = input
	return s.transaction, s.err
}

func (s *fakeTransactionService) UpdateAccountTransaction(context.Context, transaction.UpdateGuidedInput) (transaction.AccountTransaction, error) {
	return s.transaction, s.err
}

func (s *fakeTransactionService) DeleteAccountTransaction(context.Context, uuid.UUID, uuid.UUID) error {
	return s.err
}

func (s *fakeTransactionService) GetAccountPositions(context.Context, uuid.UUID) ([]transaction.Position, error) {
	return s.positions, s.err
}

func (s *fakeTransactionService) GetAccountCashBalances(context.Context, uuid.UUID) ([]transaction.CashBalance, error) {
	return s.cashBalances, s.err
}

func testAccountTransaction(accountID uuid.UUID) transaction.AccountTransaction {
	now := time.Date(2026, 7, 8, 12, 0, 0, 0, time.UTC)
	return transaction.AccountTransaction{
		Transaction: transaction.Transaction{
			ID:          uuid.MustParse("33333333-3333-3333-3333-333333333333"),
			AccountID:   accountID,
			Type:        transaction.TypeBuy,
			TradeDate:   now,
			Description: "Buy CRCL",
			Source:      transaction.SourceManual,
			Status:      transaction.StatusConfirmed,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		Currency: "CAD",
		Entries:  []transaction.AccountLedgerEntry{},
		Editable: true,
	}
}
