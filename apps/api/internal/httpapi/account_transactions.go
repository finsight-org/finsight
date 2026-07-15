package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"github.com/shopspring/decimal"

	"github.com/finsight-org/finsight/apps/api/internal/asset"
	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
	"github.com/finsight-org/finsight/apps/api/internal/transaction"
)

func (s apiServer) ListAccountTransactions(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	if s.transactions == nil {
		writeTransactionError(w, http.StatusInternalServerError, "transactions_unavailable", "transaction service is unavailable")
		return
	}
	values, err := s.transactions.ListAccountTransactions(r.Context(), uuid.UUID(id))
	if err != nil {
		writeTransactionServiceError(w, err)
		return
	}
	response := generated.AccountTransactionListResponse{Transactions: make([]generated.AccountTransaction, 0, len(values))}
	for _, value := range values {
		response.Transactions = append(response.Transactions, accountTransactionResponse(value))
	}
	writeJSON(w, http.StatusOK, response)
}

func (s apiServer) PostAccountTransaction(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	if s.transactions == nil {
		writeTransactionError(w, http.StatusInternalServerError, "transactions_unavailable", "transaction service is unavailable")
		return
	}
	var request generated.PostAccountTransactionJSONRequestBody
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeTransactionError(w, http.StatusBadRequest, "invalid_request", "request body is invalid")
		return
	}
	input, err := transactionInput(uuid.UUID(id), request)
	if err != nil {
		writeTransactionServiceError(w, err)
		return
	}
	created, err := s.transactions.RecordAccountTransaction(r.Context(), input)
	if err != nil {
		writeTransactionServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, accountTransactionResponse(created))
}

func (s apiServer) PutAccountTransaction(w http.ResponseWriter, r *http.Request, id openapi_types.UUID, transactionId openapi_types.UUID) {
	if s.transactions == nil {
		writeTransactionError(w, http.StatusInternalServerError, "transactions_unavailable", "transaction service is unavailable")
		return
	}
	var request generated.PutAccountTransactionJSONRequestBody
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeTransactionError(w, http.StatusBadRequest, "invalid_request", "request body is invalid")
		return
	}
	input, err := transactionInput(uuid.UUID(id), request)
	if err != nil {
		writeTransactionServiceError(w, err)
		return
	}
	updated, err := s.transactions.UpdateAccountTransaction(r.Context(), transaction.UpdateGuidedInput{
		TransactionID: uuid.UUID(transactionId),
		GuidedInput:   input,
	})
	if err != nil {
		writeTransactionServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, accountTransactionResponse(updated))
}

func (s apiServer) DeleteAccountTransaction(w http.ResponseWriter, r *http.Request, id openapi_types.UUID, transactionId openapi_types.UUID) {
	if s.transactions == nil {
		writeTransactionError(w, http.StatusInternalServerError, "transactions_unavailable", "transaction service is unavailable")
		return
	}
	if err := s.transactions.DeleteAccountTransaction(r.Context(), uuid.UUID(id), uuid.UUID(transactionId)); err != nil {
		writeTransactionServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s apiServer) GetAccountPositions(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	if s.transactions == nil {
		writeTransactionError(w, http.StatusInternalServerError, "transactions_unavailable", "transaction service is unavailable")
		return
	}
	values, err := s.transactions.GetAccountPositions(r.Context(), uuid.UUID(id))
	if err != nil {
		writeTransactionServiceError(w, err)
		return
	}
	positions := make([]generated.AccountPosition, 0, len(values))
	for _, value := range values {
		positions = append(positions, generated.AccountPosition{
			Asset:    accountTransactionAssetResponse(value.Asset),
			Quantity: decimalResponse(value.Quantity),
			Currency: value.Currency,
			Warnings: &[]generated.PortfolioWarning{},
		})
	}
	writeJSON(w, http.StatusOK, generated.AccountPositionsResponse{Positions: positions})
}

func (s apiServer) GetAccountCashBalances(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	if s.transactions == nil {
		writeTransactionError(w, http.StatusInternalServerError, "transactions_unavailable", "transaction service is unavailable")
		return
	}
	values, err := s.transactions.GetAccountCashBalances(r.Context(), uuid.UUID(id))
	if err != nil {
		writeTransactionServiceError(w, err)
		return
	}
	balances := make([]generated.AccountCashBalance, 0, len(values))
	for _, value := range values {
		balances = append(balances, generated.AccountCashBalance{
			Currency: value.Currency,
			Balance:  decimalResponse(value.Balance),
		})
	}
	writeJSON(w, http.StatusOK, generated.AccountCashBalancesResponse{CashBalances: balances})
}

func transactionInput(accountID uuid.UUID, request generated.AccountTransactionRequest) (transaction.GuidedInput, error) {
	quantity, err := optionalDecimal(request.Quantity)
	if err != nil {
		return transaction.GuidedInput{}, transaction.ErrInvalidAmount
	}
	price, err := optionalDecimal(request.Price)
	if err != nil {
		return transaction.GuidedInput{}, transaction.ErrInvalidAmount
	}
	amount, err := optionalDecimal(request.Amount)
	if err != nil {
		return transaction.GuidedInput{}, transaction.ErrInvalidAmount
	}
	fees, err := optionalDecimal(request.Fees)
	if err != nil {
		return transaction.GuidedInput{}, transaction.ErrInvalidAmount
	}
	var settlementDate = optionalOpenAPIDate(request.SettlementDate)
	var assetInput *transaction.AssetInput
	if request.Asset != nil {
		assetInput = &transaction.AssetInput{
			Name:           request.Asset.Name,
			Type:           asset.Type(request.Asset.AssetType),
			Currency:       request.Asset.Currency,
			Symbol:         request.Asset.Symbol,
			ProviderID:     request.Asset.ProviderId,
			ProviderSymbol: request.Asset.ProviderSymbol,
			Exchange:       request.Asset.Exchange,
		}
	}
	return transaction.GuidedInput{
		AccountID:      accountID,
		Type:           transaction.Type(request.Type),
		TradeDate:      request.TradeDate.Time,
		SettlementDate: settlementDate,
		Description:    request.Description,
		Currency:       request.Currency,
		Asset:          assetInput,
		Quantity:       quantity,
		Price:          price,
		Amount:         amount,
		Fees:           fees,
	}, nil
}

func optionalDecimal(value *string) (*decimal.Decimal, error) {
	if value == nil || *value == "" {
		return nil, nil
	}
	parsed, err := decimal.NewFromString(*value)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func optionalOpenAPIDate(value *openapi_types.Date) *time.Time {
	if value == nil {
		return nil
	}
	date := value.Time
	return &date
}

func accountTransactionResponse(value transaction.AccountTransaction) generated.AccountTransaction {
	entries := make([]generated.AccountTransactionLedgerEntry, 0, len(value.Entries))
	for _, entry := range value.Entries {
		entries = append(entries, generated.AccountTransactionLedgerEntry{
			Id:        openapiUUID(entry.ID),
			EntryType: string(entry.EntryType),
			Asset:     accountTransactionAssetResponse(entry.Asset),
			Quantity:  decimalResponse(entry.Quantity),
			Amount:    decimalResponse(entry.Amount),
			Currency:  entry.Currency,
			Direction: string(entry.Direction),
		})
	}
	return generated.AccountTransaction{
		Id:             openapiUUID(value.ID),
		AccountId:      openapiUUID(value.AccountID),
		Type:           generated.AccountTransactionType(value.Type),
		TradeDate:      openapiDate(value.TradeDate),
		SettlementDate: optionalDateResponse(value.SettlementDate),
		Description:    value.Description,
		Asset:          optionalAccountTransactionAssetResponse(value.Asset),
		Quantity:       optionalDecimalResponse(value.Quantity),
		Price:          optionalDecimalResponse(value.Price),
		Fees:           optionalDecimalResponse(value.Fees),
		CashImpact:     optionalDecimalResponse(value.CashImpact),
		Currency:       value.Currency,
		Source:         value.Source,
		Status:         string(value.Status),
		LedgerEntries:  entries,
		CreatedAt:      value.CreatedAt,
		UpdatedAt:      value.UpdatedAt,
	}
}

func accountTransactionAssetResponse(value asset.Asset) generated.AccountTransactionAsset {
	return generated.AccountTransactionAsset{
		Id:             openapiUUID(value.ID),
		Name:           value.Name,
		Symbol:         value.Symbol,
		AssetType:      generated.AssetType(value.Type),
		Currency:       value.Currency,
		ProviderId:     value.ProviderID,
		ProviderSymbol: value.ProviderSymbol,
		Exchange:       value.Exchange,
	}
}

func optionalAccountTransactionAssetResponse(value *asset.Asset) *generated.AccountTransactionAsset {
	if value == nil {
		return nil
	}
	response := accountTransactionAssetResponse(*value)
	return &response
}

func optionalDateResponse(value *time.Time) *openapi_types.Date {
	if value == nil {
		return nil
	}
	response := openapiDate(*value)
	return &response
}

func optionalDecimalResponse(value *decimal.Decimal) *string {
	if value == nil {
		return nil
	}
	response := decimalResponse(*value)
	return &response
}

func writeTransactionServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, transaction.ErrInvalidAccount), errors.Is(err, transaction.ErrNotFound):
		writeTransactionError(w, http.StatusNotFound, "transaction_not_found", "account or transaction was not found")
	case errors.Is(err, transaction.ErrImportedMutation):
		writeTransactionError(w, http.StatusConflict, "imported_transaction_read_only", "imported transactions cannot be edited or deleted")
	case errors.Is(err, transaction.ErrInvalidType):
		writeTransactionError(w, http.StatusBadRequest, "invalid_transaction_type", "transaction type is invalid")
	case errors.Is(err, transaction.ErrInvalidTradeDate):
		writeTransactionError(w, http.StatusBadRequest, "invalid_trade_date", "transaction trade date is invalid")
	case errors.Is(err, transaction.ErrInvalidAmount):
		writeTransactionError(w, http.StatusBadRequest, "invalid_transaction_amount", "transaction amount is invalid")
	case errors.Is(err, transaction.ErrInvalidAsset), errors.Is(err, transaction.ErrInvalidEntryAsset):
		writeTransactionError(w, http.StatusBadRequest, "invalid_transaction_asset", "transaction asset is invalid")
	case errors.Is(err, transaction.ErrInvalidEntryCurrency):
		writeTransactionError(w, http.StatusBadRequest, "invalid_transaction_currency", "transaction currency is invalid")
	default:
		writeTransactionError(w, http.StatusInternalServerError, "transaction_operation_failed", "transaction operation failed")
	}
}

func writeTransactionError(w http.ResponseWriter, status int, code string, message string) {
	writeJSON(w, status, generated.ErrorResponse{
		Error: generated.ErrorDetail{
			Code:    code,
			Message: message,
		},
	})
}
