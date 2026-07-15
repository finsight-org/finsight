package transaction

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/finsight-org/finsight/apps/api/internal/asset"
	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/dateutil"
)

type LocalBootstrapper interface {
	BootstrapLocal(context.Context) (bootstrap.Result, error)
}

type Repository interface {
	CreateWithEntries(context.Context, createRepositoryInput) (Transaction, error)
	ListAccountTransactions(context.Context, uuid.UUID, uuid.UUID) ([]AccountTransaction, error)
	ValidateAccount(context.Context, uuid.UUID, uuid.UUID) error
	GetAccountTransaction(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (Transaction, error)
	UpdateWithEntries(context.Context, updateRepositoryInput) (Transaction, error)
	Delete(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error
}

type AssetRegistry interface {
	UpsertAsset(context.Context, asset.UpsertInput) (asset.Asset, error)
}

type Service struct {
	bootstrap  LocalBootstrapper
	repository Repository
	assets     AssetRegistry
}

func NewService(bootstrap LocalBootstrapper, repository Repository) Service {
	return Service{bootstrap: bootstrap, repository: repository}
}

func NewServiceWithAssets(bootstrap LocalBootstrapper, repository Repository, assets AssetRegistry) Service {
	return Service{bootstrap: bootstrap, repository: repository, assets: assets}
}

func (s Service) RecordTransaction(ctx context.Context, input CreateInput) (Transaction, error) {
	if s.bootstrap == nil {
		return Transaction{}, fmt.Errorf("transaction bootstrapper is required")
	}
	if s.repository == nil {
		return Transaction{}, fmt.Errorf("transaction repository is required")
	}

	input = normalizeCreateInput(input)
	if input.AccountID == uuid.Nil {
		return Transaction{}, ErrInvalidAccount
	}
	if !validType(input.Type) {
		return Transaction{}, ErrInvalidType
	}
	if input.TradeDate.IsZero() {
		return Transaction{}, ErrInvalidTradeDate
	}
	if input.Source == "" {
		return Transaction{}, ErrInvalidSource
	}
	if len(input.LedgerEntries) == 0 {
		return Transaction{}, ErrInvalidLedgerEntry
	}
	for _, entry := range input.LedgerEntries {
		if entry.AssetID == uuid.Nil {
			return Transaction{}, ErrInvalidEntryAsset
		}
		if !validEntryType(entry.EntryType) {
			return Transaction{}, ErrInvalidEntryType
		}
		if !currencyPattern.MatchString(entry.Currency) {
			return Transaction{}, ErrInvalidEntryCurrency
		}
		if entry.OriginalCurrency != nil && !currencyPattern.MatchString(*entry.OriginalCurrency) {
			return Transaction{}, ErrInvalidEntryCurrency
		}
		if !validDirection(entry.Direction) {
			return Transaction{}, ErrInvalidLedgerEntry
		}
	}

	localContext, err := s.bootstrap.BootstrapLocal(ctx)
	if err != nil {
		return Transaction{}, fmt.Errorf("resolve local transaction context: %w", err)
	}

	recorded, err := s.repository.CreateWithEntries(ctx, createRepositoryInput{
		WorkspaceID:    localContext.Workspace.ID,
		PortfolioID:    localContext.Portfolio.ID,
		AccountID:      input.AccountID,
		ImportID:       input.ImportID,
		Type:           input.Type,
		TradeDate:      dateutil.DateOnly(input.TradeDate),
		SettlementDate: optionalDate(input.SettlementDate),
		Description:    input.Description,
		Source:         input.Source,
		ExternalID:     input.ExternalID,
		LedgerEntries:  input.LedgerEntries,
	})
	if err != nil {
		return Transaction{}, fmt.Errorf("record transaction: %w", err)
	}
	return recorded, nil
}

func (s Service) ListAccountTransactions(ctx context.Context, accountID uuid.UUID) ([]AccountTransaction, error) {
	localContext, err := s.localContext(ctx)
	if err != nil {
		return nil, err
	}
	transactions, err := s.repository.ListAccountTransactions(ctx, localContext.Portfolio.ID, accountID)
	if err != nil {
		return nil, fmt.Errorf("list account transactions: %w", err)
	}
	return transactions, nil
}

func (s Service) RecordAccountTransaction(ctx context.Context, input GuidedInput) (AccountTransaction, error) {
	localContext, err := s.localContext(ctx)
	if err != nil {
		return AccountTransaction{}, err
	}
	if err := s.repository.ValidateAccount(ctx, localContext.Portfolio.ID, input.AccountID); err != nil {
		return AccountTransaction{}, err
	}
	entries, err := s.ledgerEntriesForGuidedInput(ctx, input)
	if err != nil {
		return AccountTransaction{}, err
	}
	created, err := s.repository.CreateWithEntries(ctx, createRepositoryInput{
		WorkspaceID:    localContext.Workspace.ID,
		PortfolioID:    localContext.Portfolio.ID,
		AccountID:      input.AccountID,
		Type:           input.Type,
		TradeDate:      dateutil.DateOnly(input.TradeDate),
		SettlementDate: optionalDate(input.SettlementDate),
		Description:    strings.TrimSpace(input.Description),
		Source:         SourceManual,
		LedgerEntries:  entries,
	})
	if err != nil {
		return AccountTransaction{}, fmt.Errorf("record account transaction: %w", err)
	}
	return s.loadAccountTransaction(ctx, input.AccountID, created.ID)
}

func (s Service) UpdateAccountTransaction(ctx context.Context, input UpdateGuidedInput) (AccountTransaction, error) {
	localContext, err := s.localContext(ctx)
	if err != nil {
		return AccountTransaction{}, err
	}
	existing, err := s.repository.GetAccountTransaction(ctx, localContext.Portfolio.ID, input.AccountID, input.TransactionID)
	if err != nil {
		return AccountTransaction{}, err
	}
	if readOnlyTransaction(existing) {
		return AccountTransaction{}, ErrImportedMutation
	}
	entries, err := s.ledgerEntriesForGuidedInput(ctx, input.GuidedInput)
	if err != nil {
		return AccountTransaction{}, err
	}
	updated, err := s.repository.UpdateWithEntries(ctx, updateRepositoryInput{
		WorkspaceID:    localContext.Workspace.ID,
		PortfolioID:    localContext.Portfolio.ID,
		AccountID:      input.AccountID,
		TransactionID:  input.TransactionID,
		Type:           input.Type,
		TradeDate:      dateutil.DateOnly(input.TradeDate),
		SettlementDate: optionalDate(input.SettlementDate),
		Description:    strings.TrimSpace(input.Description),
		LedgerEntries:  entries,
	})
	if err != nil {
		return AccountTransaction{}, fmt.Errorf("update account transaction: %w", err)
	}
	return s.loadAccountTransaction(ctx, input.AccountID, updated.ID)
}

func (s Service) DeleteAccountTransaction(ctx context.Context, accountID uuid.UUID, transactionID uuid.UUID) error {
	localContext, err := s.localContext(ctx)
	if err != nil {
		return err
	}
	existing, err := s.repository.GetAccountTransaction(ctx, localContext.Portfolio.ID, accountID, transactionID)
	if err != nil {
		return err
	}
	if readOnlyTransaction(existing) {
		return ErrImportedMutation
	}
	if err := s.repository.Delete(ctx, localContext.Portfolio.ID, accountID, transactionID); err != nil {
		return fmt.Errorf("delete account transaction: %w", err)
	}
	return nil
}

func (s Service) GetAccountPositions(ctx context.Context, accountID uuid.UUID) ([]Position, error) {
	transactions, err := s.ListAccountTransactions(ctx, accountID)
	if err != nil {
		return nil, err
	}
	type positionState struct {
		asset    asset.Asset
		quantity decimal.Decimal
	}
	positionsByAsset := map[uuid.UUID]positionState{}
	for _, tx := range transactions {
		for _, entry := range tx.Entries {
			if entry.EntryType != EntryTypeAssetQuantity {
				continue
			}
			state := positionsByAsset[entry.Asset.ID]
			state.asset = entry.Asset
			state.quantity = state.quantity.Add(entry.Quantity)
			positionsByAsset[entry.Asset.ID] = state
		}
	}
	positions := make([]Position, 0, len(positionsByAsset))
	for _, state := range positionsByAsset {
		if state.quantity.IsZero() {
			continue
		}
		positions = append(positions, Position{Asset: state.asset, Quantity: state.quantity, Currency: state.asset.Currency})
	}
	return positions, nil
}

func (s Service) GetAccountCashBalances(ctx context.Context, accountID uuid.UUID) ([]CashBalance, error) {
	transactions, err := s.ListAccountTransactions(ctx, accountID)
	if err != nil {
		return nil, err
	}
	balancesByCurrency := map[string]decimal.Decimal{}
	for _, tx := range transactions {
		for _, entry := range tx.Entries {
			if entry.EntryType != EntryTypeCash {
				continue
			}
			balancesByCurrency[entry.Currency] = balancesByCurrency[entry.Currency].Add(entry.Amount)
		}
	}
	balances := make([]CashBalance, 0, len(balancesByCurrency))
	for currency, balance := range balancesByCurrency {
		if balance.IsZero() {
			continue
		}
		balances = append(balances, CashBalance{Currency: currency, Balance: balance})
	}
	return balances, nil
}

func (s Service) localContext(ctx context.Context) (bootstrap.Result, error) {
	if s.bootstrap == nil {
		return bootstrap.Result{}, fmt.Errorf("transaction bootstrapper is required")
	}
	if s.repository == nil {
		return bootstrap.Result{}, fmt.Errorf("transaction repository is required")
	}
	localContext, err := s.bootstrap.BootstrapLocal(ctx)
	if err != nil {
		return bootstrap.Result{}, fmt.Errorf("resolve local transaction context: %w", err)
	}
	return localContext, nil
}

func (s Service) loadAccountTransaction(ctx context.Context, accountID uuid.UUID, transactionID uuid.UUID) (AccountTransaction, error) {
	transactions, err := s.ListAccountTransactions(ctx, accountID)
	if err != nil {
		return AccountTransaction{}, err
	}
	for _, transaction := range transactions {
		if transaction.ID == transactionID {
			return transaction, nil
		}
	}
	return AccountTransaction{}, ErrNotFound
}

func (s Service) ledgerEntriesForGuidedInput(ctx context.Context, input GuidedInput) ([]CreateLedgerEntryInput, error) {
	if s.assets == nil {
		return nil, fmt.Errorf("transaction asset registry is required")
	}
	input = normalizeGuidedInput(input)
	if input.AccountID == uuid.Nil {
		return nil, ErrInvalidAccount
	}
	if !validGuidedType(input.Type) {
		return nil, ErrInvalidType
	}
	if input.TradeDate.IsZero() {
		return nil, ErrInvalidTradeDate
	}
	if !currencyPattern.MatchString(input.Currency) {
		return nil, ErrInvalidEntryCurrency
	}

	switch input.Type {
	case TypeBuy, TypeSell:
		if err := validateInputAsset(input.Asset); err != nil {
			return nil, err
		}
		quantity, err := positiveDecimal(input.Quantity)
		if err != nil {
			return nil, ErrInvalidAmount
		}
		price, err := positiveDecimal(input.Price)
		if err != nil {
			return nil, ErrInvalidAmount
		}
		fees, err := nonNegativeDecimal(input.Fees)
		if err != nil {
			return nil, ErrInvalidAmount
		}
		cashAsset, err := s.upsertCashAsset(ctx, input.Currency)
		if err != nil {
			return nil, err
		}
		tradedAsset, err := s.upsertInputAsset(ctx, input.Asset)
		if err != nil {
			return nil, err
		}
		gross := quantity.Mul(price)
		if input.Type == TypeBuy {
			return assetPurchaseEntries(tradedAsset.ID, cashAsset.ID, quantity, gross, fees, input.Currency), nil
		}
		return assetSaleEntries(tradedAsset.ID, cashAsset.ID, quantity, gross, fees, input.Currency), nil
	case TypeDividend:
		if err := validateInputAsset(input.Asset); err != nil {
			return nil, err
		}
		amount, err := positiveDecimal(input.Amount)
		if err != nil {
			return nil, ErrInvalidAmount
		}
		cashAsset, err := s.upsertCashAsset(ctx, input.Currency)
		if err != nil {
			return nil, err
		}
		dividendAsset, err := s.upsertInputAsset(ctx, input.Asset)
		if err != nil {
			return nil, err
		}
		return dividendEntries(dividendAsset.ID, cashAsset.ID, amount, input.Currency), nil
	case TypeDeposit, TypeWithdrawal, TypeFee, TypeInterest:
		amount, err := positiveDecimal(input.Amount)
		if err != nil {
			return nil, ErrInvalidAmount
		}
		cashAsset, err := s.upsertCashAsset(ctx, input.Currency)
		if err != nil {
			return nil, err
		}
		return cashOnlyEntries(input.Type, cashAsset.ID, amount, input.Currency), nil
	default:
		return nil, ErrInvalidType
	}
}

func (s Service) upsertCashAsset(ctx context.Context, currency string) (asset.Asset, error) {
	cashAsset, err := s.assets.UpsertAsset(ctx, asset.UpsertInput{
		Name:           currency + " Cash",
		Type:           asset.TypeCash,
		Currency:       currency,
		Symbol:         currency,
		ProviderID:     "finsight",
		ProviderSymbol: strings.ToLower(currency),
	})
	if err != nil {
		return asset.Asset{}, fmt.Errorf("upsert cash asset: %w", err)
	}
	return cashAsset, nil
}

func validateInputAsset(input *AssetInput) error {
	if input == nil {
		return ErrInvalidAsset
	}
	if !validInputAssetType(input.Type) {
		return ErrInvalidAsset
	}
	if input.Name == "" || input.Symbol == "" || input.ProviderID == "" || input.ProviderSymbol == "" {
		return ErrInvalidAsset
	}
	if !currencyPattern.MatchString(input.Currency) {
		return ErrInvalidEntryCurrency
	}
	return nil
}

func validInputAssetType(value asset.Type) bool {
	switch value {
	case asset.TypeEquity, asset.TypeETF, asset.TypeMutualFund, asset.TypeCrypto, asset.TypeOther:
		return true
	default:
		return false
	}
}

func readOnlyTransaction(value Transaction) bool {
	return value.ImportID != nil || value.Source != SourceManual
}

func (s Service) upsertInputAsset(ctx context.Context, input *AssetInput) (asset.Asset, error) {
	if err := validateInputAsset(input); err != nil {
		return asset.Asset{}, err
	}
	created, err := s.assets.UpsertAsset(ctx, asset.UpsertInput{
		Name:           input.Name,
		Type:           input.Type,
		Currency:       input.Currency,
		Symbol:         input.Symbol,
		ProviderID:     input.ProviderID,
		ProviderSymbol: input.ProviderSymbol,
		Exchange:       input.Exchange,
	})
	if err != nil {
		return asset.Asset{}, fmt.Errorf("upsert transaction asset: %w", err)
	}
	return created, nil
}

func assetPurchaseEntries(assetID uuid.UUID, cashAssetID uuid.UUID, quantity decimal.Decimal, gross decimal.Decimal, fees decimal.Decimal, currency string) []CreateLedgerEntryInput {
	entries := []CreateLedgerEntryInput{
		{AssetID: assetID, EntryType: EntryTypeAssetQuantity, Quantity: quantity, Currency: currency, Direction: DirectionIncrease},
		{AssetID: cashAssetID, EntryType: EntryTypeCash, Amount: gross.Add(fees).Neg(), Currency: currency, Direction: DirectionDecrease},
	}
	if fees.IsPositive() {
		entries = append(entries, CreateLedgerEntryInput{AssetID: cashAssetID, EntryType: EntryTypeFee, Amount: fees.Neg(), Currency: currency, Direction: DirectionDecrease})
	}
	return entries
}

func assetSaleEntries(assetID uuid.UUID, cashAssetID uuid.UUID, quantity decimal.Decimal, gross decimal.Decimal, fees decimal.Decimal, currency string) []CreateLedgerEntryInput {
	entries := []CreateLedgerEntryInput{
		{AssetID: assetID, EntryType: EntryTypeAssetQuantity, Quantity: quantity.Neg(), Currency: currency, Direction: DirectionDecrease},
		{AssetID: cashAssetID, EntryType: EntryTypeCash, Amount: gross.Sub(fees), Currency: currency, Direction: DirectionIncrease},
	}
	if fees.IsPositive() {
		entries = append(entries, CreateLedgerEntryInput{AssetID: cashAssetID, EntryType: EntryTypeFee, Amount: fees.Neg(), Currency: currency, Direction: DirectionDecrease})
	}
	return entries
}

func dividendEntries(assetID uuid.UUID, cashAssetID uuid.UUID, amount decimal.Decimal, currency string) []CreateLedgerEntryInput {
	return []CreateLedgerEntryInput{
		{AssetID: assetID, EntryType: EntryTypeIncome, Amount: amount, Currency: currency, Direction: DirectionIncrease},
		{AssetID: cashAssetID, EntryType: EntryTypeCash, Amount: amount, Currency: currency, Direction: DirectionIncrease},
	}
}

func cashOnlyEntries(transactionType Type, cashAssetID uuid.UUID, amount decimal.Decimal, currency string) []CreateLedgerEntryInput {
	switch transactionType {
	case TypeDeposit:
		return []CreateLedgerEntryInput{{AssetID: cashAssetID, EntryType: EntryTypeCash, Amount: amount, Currency: currency, Direction: DirectionIncrease}}
	case TypeWithdrawal:
		return []CreateLedgerEntryInput{{AssetID: cashAssetID, EntryType: EntryTypeCash, Amount: amount.Neg(), Currency: currency, Direction: DirectionDecrease}}
	case TypeInterest:
		return []CreateLedgerEntryInput{
			{AssetID: cashAssetID, EntryType: EntryTypeIncome, Amount: amount, Currency: currency, Direction: DirectionIncrease},
			{AssetID: cashAssetID, EntryType: EntryTypeCash, Amount: amount, Currency: currency, Direction: DirectionIncrease},
		}
	case TypeFee:
		return []CreateLedgerEntryInput{
			{AssetID: cashAssetID, EntryType: EntryTypeFee, Amount: amount.Neg(), Currency: currency, Direction: DirectionDecrease},
			{AssetID: cashAssetID, EntryType: EntryTypeCash, Amount: amount.Neg(), Currency: currency, Direction: DirectionDecrease},
		}
	default:
		return nil
	}
}

func positiveDecimal(value *decimal.Decimal) (decimal.Decimal, error) {
	if value == nil || !value.IsPositive() {
		return decimal.Decimal{}, ErrInvalidAmount
	}
	return *value, nil
}

func nonNegativeDecimal(value *decimal.Decimal) (decimal.Decimal, error) {
	if value == nil {
		return decimal.Zero, nil
	}
	if value.IsNegative() {
		return decimal.Decimal{}, ErrInvalidAmount
	}
	return *value, nil
}

func optionalDate(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	truncated := dateutil.DateOnly(*value)
	return &truncated
}
