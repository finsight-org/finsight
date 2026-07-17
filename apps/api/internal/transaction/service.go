package transaction

import (
	"context"
	"fmt"
	"sort"
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
	CreateWithEntries(context.Context, createRepositoryInput) (repositoryResult, error)
	ListAccountTransactions(context.Context, uuid.UUID, uuid.UUID) ([]AccountTransaction, error)
	GetAccountTransaction(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (Transaction, error)
	UpdateWithEntries(context.Context, updateRepositoryInput) (repositoryResult, error)
	Delete(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error
}

type Service struct {
	bootstrap  LocalBootstrapper
	repository Repository
	now        func() time.Time
}

func NewService(bootstrap LocalBootstrapper, repository Repository) Service {
	return Service{bootstrap: bootstrap, repository: repository, now: time.Now}
}

func NewServiceWithClock(bootstrap LocalBootstrapper, repository Repository, now func() time.Time) Service {
	return Service{bootstrap: bootstrap, repository: repository, now: now}
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
		if !fitsLedgerDecimal(entry.Quantity) || !fitsLedgerDecimal(entry.Amount) {
			return Transaction{}, ErrInvalidAmount
		}
		if entry.OriginalAmount != nil && !fitsLedgerDecimal(*entry.OriginalAmount) {
			return Transaction{}, ErrInvalidAmount
		}
		if entry.ExchangeRate != nil && (!entry.ExchangeRate.IsPositive() || !fitsLedgerDecimal(*entry.ExchangeRate)) {
			return Transaction{}, ErrInvalidAmount
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
	return recorded.Transaction, nil
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
	plan, err := ledgerPlanForGuidedInput(input)
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
		AssetUpserts:   plan.AssetUpserts,
		LedgerEntries:  plan.LedgerEntries,
	})
	if err != nil {
		return AccountTransaction{}, fmt.Errorf("record account transaction: %w", err)
	}
	return accountTransactionFromResult(created)
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
	if !validGuidedType(existing.Type) {
		return AccountTransaction{}, ErrUnsupportedMutation
	}
	plan, err := ledgerPlanForGuidedInput(input.GuidedInput)
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
		AssetUpserts:   plan.AssetUpserts,
		LedgerEntries:  plan.LedgerEntries,
	})
	if err != nil {
		return AccountTransaction{}, fmt.Errorf("update account transaction: %w", err)
	}
	return accountTransactionFromResult(updated)
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
	if !validGuidedType(existing.Type) {
		return ErrUnsupportedMutation
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
	valuationDate := s.valuationDate()
	for _, tx := range transactions {
		if dateutil.DateOnly(tx.TradeDate).After(valuationDate) {
			continue
		}
		for _, entry := range tx.Entries {
			if entry.EntryType != EntryTypeAssetQuantity || entry.Asset.Type == asset.TypeCash {
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
	sort.Slice(positions, func(i, j int) bool {
		if positions[i].Asset.Symbol != positions[j].Asset.Symbol {
			return positions[i].Asset.Symbol < positions[j].Asset.Symbol
		}
		return positions[i].Asset.ID.String() < positions[j].Asset.ID.String()
	})
	return positions, nil
}

func (s Service) GetAccountCashBalances(ctx context.Context, accountID uuid.UUID) ([]CashBalance, error) {
	transactions, err := s.ListAccountTransactions(ctx, accountID)
	if err != nil {
		return nil, err
	}
	balancesByCurrency := map[string]decimal.Decimal{}
	valuationDate := s.valuationDate()
	for _, tx := range transactions {
		if dateutil.DateOnly(tx.TradeDate).After(valuationDate) {
			continue
		}
		for _, entry := range tx.Entries {
			if entry.EntryType != EntryTypeCash || entry.Asset.Type != asset.TypeCash {
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
	sort.Slice(balances, func(i, j int) bool { return balances[i].Currency < balances[j].Currency })
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

func (s Service) valuationDate() time.Time {
	now := time.Now
	if s.now != nil {
		now = s.now
	}
	return dateutil.DateOnly(now().UTC())
}

func accountTransactionFromResult(result repositoryResult) (AccountTransaction, error) {
	if result.AccountTransaction == nil {
		return AccountTransaction{}, fmt.Errorf("account transaction result is required")
	}
	return *result.AccountTransaction, nil
}

type guidedLedgerPlan struct {
	AssetUpserts  []repositoryAssetUpsert
	LedgerEntries []CreateLedgerEntryInput
}

func ledgerPlanForGuidedInput(input GuidedInput) (guidedLedgerPlan, error) {
	input = normalizeGuidedInput(input)
	if input.AccountID == uuid.Nil {
		return guidedLedgerPlan{}, ErrInvalidAccount
	}
	if !validGuidedType(input.Type) {
		return guidedLedgerPlan{}, ErrInvalidType
	}
	if input.TradeDate.IsZero() {
		return guidedLedgerPlan{}, ErrInvalidTradeDate
	}
	if input.SettlementDate != nil && dateutil.DateOnly(*input.SettlementDate).Before(dateutil.DateOnly(input.TradeDate)) {
		return guidedLedgerPlan{}, ErrInvalidTradeDate
	}
	if !currencyPattern.MatchString(input.Currency) {
		return guidedLedgerPlan{}, ErrInvalidEntryCurrency
	}

	switch input.Type {
	case TypeBuy, TypeSell:
		if input.Amount != nil {
			return guidedLedgerPlan{}, ErrInvalidAmount
		}
		if err := validateInputAsset(input.Asset); err != nil {
			return guidedLedgerPlan{}, err
		}
		if input.Asset.Currency != input.Currency {
			return guidedLedgerPlan{}, ErrInvalidEntryCurrency
		}
		quantity, err := positiveDecimal(input.Quantity)
		if err != nil {
			return guidedLedgerPlan{}, ErrInvalidAmount
		}
		price, err := positiveDecimal(input.Price)
		if err != nil {
			return guidedLedgerPlan{}, ErrInvalidAmount
		}
		fees, err := nonNegativeDecimal(input.Fees)
		if err != nil {
			return guidedLedgerPlan{}, ErrInvalidAmount
		}
		gross := quantity.Mul(price)
		if !fitsLedgerDecimal(gross) {
			return guidedLedgerPlan{}, ErrInvalidAmount
		}
		cashAmount := gross.Add(fees)
		if input.Type == TypeSell {
			if fees.GreaterThan(gross) {
				return guidedLedgerPlan{}, ErrInvalidAmount
			}
			cashAmount = gross.Sub(fees)
		}
		if !fitsLedgerDecimal(cashAmount) {
			return guidedLedgerPlan{}, ErrInvalidAmount
		}
		upserts, err := guidedAssetUpserts(input.Currency, input.Asset)
		if err != nil {
			return guidedLedgerPlan{}, err
		}
		if input.Type == TypeBuy {
			return guidedLedgerPlan{AssetUpserts: upserts, LedgerEntries: assetPurchaseEntries(quantity, gross, fees, input.Currency)}, nil
		}
		return guidedLedgerPlan{AssetUpserts: upserts, LedgerEntries: assetSaleEntries(quantity, gross, fees, input.Currency)}, nil
	case TypeDividend:
		if input.Quantity != nil || input.Price != nil || input.Fees != nil {
			return guidedLedgerPlan{}, ErrInvalidAmount
		}
		if err := validateInputAsset(input.Asset); err != nil {
			return guidedLedgerPlan{}, err
		}
		if input.Asset.Currency != input.Currency {
			return guidedLedgerPlan{}, ErrInvalidEntryCurrency
		}
		amount, err := positiveDecimal(input.Amount)
		if err != nil {
			return guidedLedgerPlan{}, ErrInvalidAmount
		}
		upserts, err := guidedAssetUpserts(input.Currency, input.Asset)
		if err != nil {
			return guidedLedgerPlan{}, err
		}
		return guidedLedgerPlan{AssetUpserts: upserts, LedgerEntries: dividendEntries(amount, input.Currency)}, nil
	case TypeDeposit, TypeWithdrawal, TypeFee, TypeInterest:
		if input.Asset != nil {
			return guidedLedgerPlan{}, ErrInvalidAsset
		}
		if input.Quantity != nil || input.Price != nil || input.Fees != nil {
			return guidedLedgerPlan{}, ErrInvalidAmount
		}
		amount, err := positiveDecimal(input.Amount)
		if err != nil {
			return guidedLedgerPlan{}, ErrInvalidAmount
		}
		cashUpsert, err := cashAssetUpsert(input.Currency)
		if err != nil {
			return guidedLedgerPlan{}, err
		}
		return guidedLedgerPlan{
			AssetUpserts:  []repositoryAssetUpsert{cashUpsert},
			LedgerEntries: cashOnlyEntries(input.Type, amount, input.Currency),
		}, nil
	default:
		return guidedLedgerPlan{}, ErrInvalidType
	}
}

func cashAssetUpsert(currency string) (repositoryAssetUpsert, error) {
	prepared, err := asset.PrepareUpsertInput(asset.UpsertInput{
		Name:           currency + " Cash",
		Type:           asset.TypeCash,
		Currency:       currency,
		Symbol:         currency,
		ProviderID:     "finsight",
		ProviderSymbol: strings.ToLower(currency),
	})
	if err != nil {
		return repositoryAssetUpsert{}, fmt.Errorf("prepare cash asset: %w", err)
	}
	return repositoryAssetUpsert{Reference: ledgerAssetCash, Input: prepared}, nil
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
	return value.ImportID != nil || value.ExternalID != nil || value.Source != SourceManual
}

func instrumentAssetUpsert(input *AssetInput) (repositoryAssetUpsert, error) {
	if err := validateInputAsset(input); err != nil {
		return repositoryAssetUpsert{}, err
	}
	prepared, err := asset.PrepareUpsertInput(asset.UpsertInput{
		Name:           input.Name,
		Type:           input.Type,
		Currency:       input.Currency,
		Symbol:         input.Symbol,
		ProviderID:     input.ProviderID,
		ProviderSymbol: input.ProviderSymbol,
		Exchange:       input.Exchange,
	})
	if err != nil {
		return repositoryAssetUpsert{}, ErrInvalidAsset
	}
	return repositoryAssetUpsert{Reference: ledgerAssetInstrument, Input: prepared}, nil
}

func guidedAssetUpserts(currency string, input *AssetInput) ([]repositoryAssetUpsert, error) {
	cashUpsert, err := cashAssetUpsert(currency)
	if err != nil {
		return nil, err
	}
	instrumentUpsert, err := instrumentAssetUpsert(input)
	if err != nil {
		return nil, err
	}
	return []repositoryAssetUpsert{cashUpsert, instrumentUpsert}, nil
}

func assetPurchaseEntries(quantity decimal.Decimal, gross decimal.Decimal, fees decimal.Decimal, currency string) []CreateLedgerEntryInput {
	entries := []CreateLedgerEntryInput{
		{assetReference: ledgerAssetInstrument, EntryType: EntryTypeAssetQuantity, Quantity: quantity, Currency: currency, Direction: DirectionIncrease},
		{assetReference: ledgerAssetCash, EntryType: EntryTypeCash, Amount: gross.Add(fees).Neg(), Currency: currency, Direction: DirectionDecrease},
	}
	if fees.IsPositive() {
		entries = append(entries, CreateLedgerEntryInput{assetReference: ledgerAssetCash, EntryType: EntryTypeFee, Amount: fees, Currency: currency, Direction: DirectionDecrease})
	}
	return entries
}

func assetSaleEntries(quantity decimal.Decimal, gross decimal.Decimal, fees decimal.Decimal, currency string) []CreateLedgerEntryInput {
	entries := []CreateLedgerEntryInput{
		{assetReference: ledgerAssetInstrument, EntryType: EntryTypeAssetQuantity, Quantity: quantity.Neg(), Currency: currency, Direction: DirectionDecrease},
		{assetReference: ledgerAssetCash, EntryType: EntryTypeCash, Amount: gross.Sub(fees), Currency: currency, Direction: DirectionIncrease},
	}
	if fees.IsPositive() {
		entries = append(entries, CreateLedgerEntryInput{assetReference: ledgerAssetCash, EntryType: EntryTypeFee, Amount: fees, Currency: currency, Direction: DirectionDecrease})
	}
	return entries
}

func dividendEntries(amount decimal.Decimal, currency string) []CreateLedgerEntryInput {
	return []CreateLedgerEntryInput{
		{assetReference: ledgerAssetInstrument, EntryType: EntryTypeIncome, Amount: amount, Currency: currency, Direction: DirectionIncrease},
		{assetReference: ledgerAssetCash, EntryType: EntryTypeCash, Amount: amount, Currency: currency, Direction: DirectionIncrease},
	}
}

func cashOnlyEntries(transactionType Type, amount decimal.Decimal, currency string) []CreateLedgerEntryInput {
	switch transactionType {
	case TypeDeposit:
		return []CreateLedgerEntryInput{{assetReference: ledgerAssetCash, EntryType: EntryTypeCash, Amount: amount, Currency: currency, Direction: DirectionIncrease}}
	case TypeWithdrawal:
		return []CreateLedgerEntryInput{{assetReference: ledgerAssetCash, EntryType: EntryTypeCash, Amount: amount.Neg(), Currency: currency, Direction: DirectionDecrease}}
	case TypeInterest:
		return []CreateLedgerEntryInput{
			{assetReference: ledgerAssetCash, EntryType: EntryTypeIncome, Amount: amount, Currency: currency, Direction: DirectionIncrease},
			{assetReference: ledgerAssetCash, EntryType: EntryTypeCash, Amount: amount, Currency: currency, Direction: DirectionIncrease},
		}
	case TypeFee:
		return []CreateLedgerEntryInput{
			{assetReference: ledgerAssetCash, EntryType: EntryTypeFee, Amount: amount, Currency: currency, Direction: DirectionDecrease},
			{assetReference: ledgerAssetCash, EntryType: EntryTypeCash, Amount: amount.Neg(), Currency: currency, Direction: DirectionDecrease},
		}
	default:
		return nil
	}
}

func positiveDecimal(value *decimal.Decimal) (decimal.Decimal, error) {
	if value == nil || !value.IsPositive() {
		return decimal.Decimal{}, ErrInvalidAmount
	}
	if !fitsLedgerDecimal(*value) {
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
	if !fitsLedgerDecimal(*value) {
		return decimal.Decimal{}, ErrInvalidAmount
	}
	return *value, nil
}

func fitsLedgerDecimal(value decimal.Decimal) bool {
	const maxScale = 12
	if !value.Truncate(maxScale).Equal(value) {
		return false
	}
	return value.Abs().LessThan(decimal.New(1, 26))
}

func optionalDate(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	truncated := dateutil.DateOnly(*value)
	return &truncated
}
