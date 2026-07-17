package transaction

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/finsight-org/finsight/apps/api/internal/asset"
	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/identity"
	"github.com/finsight-org/finsight/apps/api/internal/portfolio"
)

func TestRecordTransactionPassesWorkspaceAndPortfolioContext(t *testing.T) {
	workspaceID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	accountID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	assetID := uuid.MustParse("66666666-6666-6666-6666-666666666666")
	repository := &fakeTransactionRepository{}
	service := NewService(fakeTransactionBootstrapper{result: transactionBootstrapResult(workspaceID, portfolioID)}, repository)

	_, err := service.RecordTransaction(context.Background(), CreateInput{
		AccountID:   accountID,
		Type:        TypeOpeningBalance,
		TradeDate:   time.Date(2026, 7, 8, 14, 30, 0, 0, time.FixedZone("EDT", -4*60*60)),
		Description: "  Opening balance  ",
		Source:      " demo ",
		LedgerEntries: []CreateLedgerEntryInput{
			{
				AssetID:   assetID,
				EntryType: EntryTypeCash,
				Amount:    decimal.NewFromInt(1000),
				Currency:  "CAD",
				Direction: DirectionIncrease,
			},
		},
	})
	if err != nil {
		t.Fatalf("RecordTransaction() error = %v", err)
	}

	if repository.input.WorkspaceID != workspaceID {
		t.Fatalf("workspace id = %s, want %s", repository.input.WorkspaceID, workspaceID)
	}
	if repository.input.PortfolioID != portfolioID {
		t.Fatalf("portfolio id = %s, want %s", repository.input.PortfolioID, portfolioID)
	}
	if repository.input.AccountID != accountID {
		t.Fatalf("account id = %s, want %s", repository.input.AccountID, accountID)
	}
	if repository.input.TradeDate != time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC) {
		t.Fatalf("trade date = %s, want 2026-07-08 UTC", repository.input.TradeDate)
	}
	if repository.input.Source != "DEMO" {
		t.Fatalf("source = %q, want DEMO", repository.input.Source)
	}
}

func TestRecordAccountTransactionBuildsBuyLedgerEntries(t *testing.T) {
	workspaceID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	accountID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	repository := &fakeTransactionRepository{createdID: uuid.MustParse("88888888-8888-8888-8888-888888888888")}
	service := NewService(
		fakeTransactionBootstrapper{result: transactionBootstrapResult(workspaceID, portfolioID)},
		repository,
	)
	quantity := decimal.NewFromInt(2)
	price := decimal.NewFromInt(10)
	fees := decimal.RequireFromString("1.25")

	_, err := service.RecordAccountTransaction(context.Background(), GuidedInput{
		AccountID:   accountID,
		Type:        TypeBuy,
		TradeDate:   time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
		Description: "Buy CRCL",
		Currency:    "CAD",
		Quantity:    &quantity,
		Price:       &price,
		Fees:        &fees,
		Asset:       &AssetInput{Name: "Circle", Type: asset.TypeEquity, Currency: "CAD", Symbol: "CRCL", ProviderID: "manual", ProviderSymbol: "CRCL"},
	})
	if err != nil {
		t.Fatalf("RecordAccountTransaction() error = %v", err)
	}

	if repository.input.Source != SourceManual {
		t.Fatalf("source = %q, want %s", repository.input.Source, SourceManual)
	}
	if len(repository.input.LedgerEntries) != 3 {
		t.Fatalf("ledger entries = %d, want 3", len(repository.input.LedgerEntries))
	}
	if !repository.input.LedgerEntries[0].Quantity.Equal(quantity) || repository.input.LedgerEntries[0].EntryType != EntryTypeAssetQuantity {
		t.Fatalf("asset quantity entry = %+v", repository.input.LedgerEntries[0])
	}
	wantCash := decimal.RequireFromString("-21.25")
	if !repository.input.LedgerEntries[1].Amount.Equal(wantCash) || repository.input.LedgerEntries[1].EntryType != EntryTypeCash {
		t.Fatalf("cash entry = %+v, want amount %s", repository.input.LedgerEntries[1], wantCash)
	}
	if !repository.input.LedgerEntries[2].Amount.Equal(fees) || repository.input.LedgerEntries[2].EntryType != EntryTypeFee {
		t.Fatalf("fee entry = %+v, want positive amount %s", repository.input.LedgerEntries[2], fees)
	}
}

func TestGuidedFeeLedgerEntriesStorePositiveExpenseAmounts(t *testing.T) {
	quantity := decimal.NewFromInt(2)
	gross := decimal.NewFromInt(20)
	fees := decimal.RequireFromString("1.25")

	buyEntries := assetPurchaseEntries(quantity, gross, fees, "CAD")
	if !buyEntries[2].Amount.Equal(fees) || buyEntries[2].EntryType != EntryTypeFee || buyEntries[2].Direction != DirectionDecrease {
		t.Fatalf("buy fee entry = %+v, want positive fee expense", buyEntries[2])
	}

	sellEntries := assetSaleEntries(quantity, gross, fees, "CAD")
	if !sellEntries[2].Amount.Equal(fees) || sellEntries[2].EntryType != EntryTypeFee || sellEntries[2].Direction != DirectionDecrease {
		t.Fatalf("sell fee entry = %+v, want positive fee expense", sellEntries[2])
	}

	feeEntries := cashOnlyEntries(TypeFee, fees, "CAD")
	if !feeEntries[0].Amount.Equal(fees) || feeEntries[0].EntryType != EntryTypeFee || feeEntries[0].Direction != DirectionDecrease {
		t.Fatalf("standalone fee entry = %+v, want positive fee expense", feeEntries[0])
	}
}

func TestAccountDerivedViewsExcludeFutureTransactions(t *testing.T) {
	workspaceID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	accountID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	stockID := uuid.MustParse("66666666-6666-6666-6666-666666666666")
	cashID := uuid.MustParse("77777777-7777-7777-7777-777777777777")
	stock := asset.Asset{ID: stockID, Name: "Circle", Type: asset.TypeEquity, Currency: "CAD", Symbol: "CRCL"}
	cash := asset.Asset{ID: cashID, Name: "CAD Cash", Type: asset.TypeCash, Currency: "CAD", Symbol: "CAD"}
	service := NewServiceWithClock(
		fakeTransactionBootstrapper{result: transactionBootstrapResult(workspaceID, portfolioID)},
		&fakeTransactionRepository{
			transactions: []AccountTransaction{
				{
					Transaction: Transaction{ID: uuid.New(), PortfolioID: portfolioID, AccountID: accountID, Type: TypeBuy, TradeDate: time.Date(2026, 7, 16, 0, 0, 0, 0, time.UTC), Source: SourceManual, Status: StatusConfirmed},
					Entries: []AccountLedgerEntry{
						{LedgerEntry: LedgerEntry{EntryType: EntryTypeAssetQuantity, Quantity: decimal.NewFromInt(2)}, Asset: stock},
						{LedgerEntry: LedgerEntry{EntryType: EntryTypeCash, Amount: decimal.NewFromInt(-20), Currency: "CAD"}, Asset: cash},
					},
				},
				{
					Transaction: Transaction{ID: uuid.New(), PortfolioID: portfolioID, AccountID: accountID, Type: TypeBuy, TradeDate: time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC), Source: SourceManual, Status: StatusConfirmed},
					Entries: []AccountLedgerEntry{
						{LedgerEntry: LedgerEntry{EntryType: EntryTypeAssetQuantity, Quantity: decimal.NewFromInt(5)}, Asset: stock},
						{LedgerEntry: LedgerEntry{EntryType: EntryTypeCash, Amount: decimal.NewFromInt(-50), Currency: "CAD"}, Asset: cash},
					},
				},
			},
		},
		func() time.Time { return time.Date(2026, 7, 16, 23, 30, 0, 0, time.UTC) },
	)

	positions, err := service.GetAccountPositions(context.Background(), accountID)
	if err != nil {
		t.Fatalf("GetAccountPositions() error = %v", err)
	}
	if len(positions) != 1 || !positions[0].Quantity.Equal(decimal.NewFromInt(2)) {
		t.Fatalf("positions = %+v, want one current position with quantity 2", positions)
	}

	balances, err := service.GetAccountCashBalances(context.Background(), accountID)
	if err != nil {
		t.Fatalf("GetAccountCashBalances() error = %v", err)
	}
	if len(balances) != 1 || balances[0].Currency != "CAD" || !balances[0].Balance.Equal(decimal.NewFromInt(-20)) {
		t.Fatalf("cash balances = %+v, want CAD -20", balances)
	}
}

func TestRecordAccountTransactionValidatesBeforeAssetUpsert(t *testing.T) {
	workspaceID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	accountID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	repository := &fakeTransactionRepository{}
	service := NewService(
		fakeTransactionBootstrapper{result: transactionBootstrapResult(workspaceID, portfolioID)},
		repository,
	)
	price := decimal.NewFromInt(10)

	_, err := service.RecordAccountTransaction(context.Background(), GuidedInput{
		AccountID:   accountID,
		Type:        TypeBuy,
		TradeDate:   time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
		Description: "Buy CRCL",
		Currency:    "CAD",
		Price:       &price,
		Asset:       &AssetInput{Name: "Circle", Type: asset.TypeEquity, Currency: "CAD", Symbol: "CRCL", ProviderID: "manual", ProviderSymbol: "CRCL"},
	})
	if err == nil {
		t.Fatal("RecordAccountTransaction() error = nil, want validation error")
	}
	if repository.createCalls != 0 {
		t.Fatalf("repository create calls = %d, want 0", repository.createCalls)
	}
}

func TestRecordAccountTransactionRejectsLedgerPrecisionOverflowBeforeUpsert(t *testing.T) {
	workspaceID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	accountID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	repository := &fakeTransactionRepository{}
	service := NewService(
		fakeTransactionBootstrapper{result: transactionBootstrapResult(workspaceID, portfolioID)},
		repository,
	)
	amount := decimal.RequireFromString("123456789012345678901234567")

	_, err := service.RecordAccountTransaction(context.Background(), GuidedInput{
		AccountID:   accountID,
		Type:        TypeDeposit,
		TradeDate:   time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
		Description: "Oversized deposit",
		Currency:    "CAD",
		Amount:      &amount,
	})
	if err != ErrInvalidAmount {
		t.Fatalf("RecordAccountTransaction() error = %v, want %v", err, ErrInvalidAmount)
	}
	if repository.createCalls != 0 {
		t.Fatalf("repository create calls = %d, want 0", repository.createCalls)
	}
}

func TestRecordAccountTransactionRejectsLedgerScaleOverflowBeforeUpsert(t *testing.T) {
	workspaceID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	accountID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	repository := &fakeTransactionRepository{}
	service := NewService(
		fakeTransactionBootstrapper{result: transactionBootstrapResult(workspaceID, portfolioID)},
		repository,
	)
	amount := decimal.RequireFromString("1.1234567890123")

	_, err := service.RecordAccountTransaction(context.Background(), GuidedInput{
		AccountID:   accountID,
		Type:        TypeDeposit,
		TradeDate:   time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
		Description: "Overprecise deposit",
		Currency:    "CAD",
		Amount:      &amount,
	})
	if err != ErrInvalidAmount {
		t.Fatalf("RecordAccountTransaction() error = %v, want %v", err, ErrInvalidAmount)
	}
	if repository.createCalls != 0 {
		t.Fatalf("repository create calls = %d, want 0", repository.createCalls)
	}
}

func TestRecordAccountTransactionRejectsComputedLedgerScaleOverflowBeforeUpsert(t *testing.T) {
	workspaceID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	accountID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	repository := &fakeTransactionRepository{}
	service := NewService(
		fakeTransactionBootstrapper{result: transactionBootstrapResult(workspaceID, portfolioID)},
		repository,
	)
	quantity := decimal.RequireFromString("1.000000000001")
	price := decimal.RequireFromString("1.000000000001")

	_, err := service.RecordAccountTransaction(context.Background(), GuidedInput{
		AccountID:   accountID,
		Type:        TypeBuy,
		TradeDate:   time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
		Description: "Overprecise buy",
		Currency:    "CAD",
		Quantity:    &quantity,
		Price:       &price,
		Asset:       &AssetInput{Name: "Circle", Type: asset.TypeEquity, Currency: "CAD", Symbol: "CRCL", ProviderID: "manual", ProviderSymbol: "CRCL"},
	})
	if err != ErrInvalidAmount {
		t.Fatalf("RecordAccountTransaction() error = %v, want %v", err, ErrInvalidAmount)
	}
	if repository.createCalls != 0 {
		t.Fatalf("repository create calls = %d, want 0", repository.createCalls)
	}
}

func TestRecordAccountTransactionRejectsSellFeesGreaterThanGrossBeforeUpsert(t *testing.T) {
	workspaceID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	accountID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	repository := &fakeTransactionRepository{}
	service := NewService(
		fakeTransactionBootstrapper{result: transactionBootstrapResult(workspaceID, portfolioID)},
		repository,
	)
	quantity := decimal.NewFromInt(2)
	price := decimal.NewFromInt(10)
	fees := decimal.NewFromInt(21)

	_, err := service.RecordAccountTransaction(context.Background(), GuidedInput{
		AccountID:   accountID,
		Type:        TypeSell,
		TradeDate:   time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
		Description: "Sell CRCL",
		Currency:    "CAD",
		Quantity:    &quantity,
		Price:       &price,
		Fees:        &fees,
		Asset:       &AssetInput{Name: "Circle", Type: asset.TypeEquity, Currency: "CAD", Symbol: "CRCL", ProviderID: "manual", ProviderSymbol: "CRCL"},
	})
	if err != ErrInvalidAmount {
		t.Fatalf("RecordAccountTransaction() error = %v, want %v", err, ErrInvalidAmount)
	}
	if repository.createCalls != 0 {
		t.Fatalf("repository create calls = %d, want 0", repository.createCalls)
	}
}

func TestRecordAccountTransactionRejectsInvalidAssetTypeBeforeUpsert(t *testing.T) {
	workspaceID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	accountID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	repository := &fakeTransactionRepository{}
	service := NewService(
		fakeTransactionBootstrapper{result: transactionBootstrapResult(workspaceID, portfolioID)},
		repository,
	)
	quantity := decimal.NewFromInt(2)
	price := decimal.NewFromInt(10)

	_, err := service.RecordAccountTransaction(context.Background(), GuidedInput{
		AccountID:   accountID,
		Type:        TypeBuy,
		TradeDate:   time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
		Description: "Buy CAD cash",
		Currency:    "CAD",
		Quantity:    &quantity,
		Price:       &price,
		Asset:       &AssetInput{Name: "CAD Cash", Type: asset.TypeCash, Currency: "CAD", Symbol: "CAD", ProviderID: "manual", ProviderSymbol: "CAD"},
	})
	if err != ErrInvalidAsset {
		t.Fatalf("RecordAccountTransaction() error = %v, want %v", err, ErrInvalidAsset)
	}
	if repository.createCalls != 0 {
		t.Fatalf("repository create calls = %d, want 0", repository.createCalls)
	}
}

func TestGuidedTransactionRejectsIncoherentDatesAndAssetCurrency(t *testing.T) {
	quantity := decimal.NewFromInt(1)
	price := decimal.NewFromInt(10)
	base := GuidedInput{
		AccountID: uuid.New(),
		Type:      TypeBuy,
		TradeDate: time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
		Currency:  "CAD",
		Quantity:  &quantity,
		Price:     &price,
		Asset:     &AssetInput{Name: "Circle", Type: asset.TypeEquity, Currency: "CAD", Symbol: "CRCL", ProviderID: "manual", ProviderSymbol: "CRCL"},
	}

	settlementBeforeTrade := base
	settlementDate := time.Date(2026, 7, 7, 0, 0, 0, 0, time.UTC)
	settlementBeforeTrade.SettlementDate = &settlementDate
	if _, err := ledgerPlanForGuidedInput(settlementBeforeTrade); err != ErrInvalidTradeDate {
		t.Fatalf("ledgerPlanForGuidedInput() settlement error = %v, want %v", err, ErrInvalidTradeDate)
	}

	assetCurrencyMismatch := base
	assetCurrencyMismatch.Asset = &AssetInput{Name: "Circle", Type: asset.TypeEquity, Currency: "USD", Symbol: "CRCL", ProviderID: "manual", ProviderSymbol: "CRCL"}
	if _, err := ledgerPlanForGuidedInput(assetCurrencyMismatch); err != ErrInvalidEntryCurrency {
		t.Fatalf("ledgerPlanForGuidedInput() currency error = %v, want %v", err, ErrInvalidEntryCurrency)
	}
}

func TestGuidedTransactionRejectsFieldsThatDoNotApplyToType(t *testing.T) {
	amount := decimal.NewFromInt(10)
	quantity := decimal.NewFromInt(1)
	price := decimal.NewFromInt(10)
	fees := decimal.NewFromInt(1)
	instrument := &AssetInput{Name: "Circle", Type: asset.TypeEquity, Currency: "CAD", Symbol: "CRCL", ProviderID: "manual", ProviderSymbol: "CRCL"}
	base := GuidedInput{AccountID: uuid.New(), TradeDate: time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC), Currency: "CAD"}

	tests := []struct {
		name  string
		input GuidedInput
		want  error
	}{
		{
			name: "buy amount",
			input: GuidedInput{
				AccountID: base.AccountID, Type: TypeBuy, TradeDate: base.TradeDate, Currency: "CAD",
				Asset: instrument, Quantity: &quantity, Price: &price, Amount: &amount,
			},
			want: ErrInvalidAmount,
		},
		{
			name: "deposit asset",
			input: GuidedInput{
				AccountID: base.AccountID, Type: TypeDeposit, TradeDate: base.TradeDate, Currency: "CAD",
				Asset: instrument, Amount: &amount,
			},
			want: ErrInvalidAsset,
		},
		{
			name: "dividend fees",
			input: GuidedInput{
				AccountID: base.AccountID, Type: TypeDividend, TradeDate: base.TradeDate, Currency: "CAD",
				Asset: instrument, Amount: &amount, Fees: &fees,
			},
			want: ErrInvalidAmount,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := ledgerPlanForGuidedInput(test.input); err != test.want {
				t.Fatalf("ledgerPlanForGuidedInput() error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestRecordTransactionRejectsInvalidExchangeRatePrecision(t *testing.T) {
	repository := &fakeTransactionRepository{}
	service := NewService(fakeTransactionBootstrapper{}, repository)
	exchangeRate := decimal.RequireFromString("1.1234567890123")

	_, err := service.RecordTransaction(context.Background(), CreateInput{
		AccountID: uuid.New(),
		Type:      TypeFXConversion,
		TradeDate: time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
		Source:    "CSV_IMPORT",
		LedgerEntries: []CreateLedgerEntryInput{{
			AssetID:      uuid.New(),
			EntryType:    EntryTypeFX,
			Currency:     "CAD",
			Direction:    DirectionIncrease,
			ExchangeRate: &exchangeRate,
		}},
	})
	if err != ErrInvalidAmount {
		t.Fatalf("RecordTransaction() error = %v, want %v", err, ErrInvalidAmount)
	}
	if repository.createCalls != 0 {
		t.Fatalf("repository create calls = %d, want 0", repository.createCalls)
	}
}

func TestImportedAccountTransactionCannotBeUpdatedOrDeleted(t *testing.T) {
	workspaceID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	accountID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	transactionID := uuid.MustParse("88888888-8888-8888-8888-888888888888")
	importID := uuid.MustParse("99999999-9999-9999-9999-999999999999")
	repository := &fakeTransactionRepository{
		transaction: Transaction{
			ID:          transactionID,
			PortfolioID: portfolioID,
			AccountID:   accountID,
			ImportID:    &importID,
			Source:      "CSV_IMPORT",
			Status:      StatusConfirmed,
		},
	}
	service := NewService(
		fakeTransactionBootstrapper{result: transactionBootstrapResult(workspaceID, portfolioID)},
		repository,
	)
	amount := decimal.NewFromInt(100)
	input := UpdateGuidedInput{
		TransactionID: transactionID,
		GuidedInput: GuidedInput{
			AccountID:   accountID,
			Type:        TypeDeposit,
			TradeDate:   time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
			Description: "Deposit",
			Currency:    "CAD",
			Amount:      &amount,
		},
	}

	if _, err := service.UpdateAccountTransaction(context.Background(), input); err != ErrImportedMutation {
		t.Fatalf("UpdateAccountTransaction() error = %v, want %v", err, ErrImportedMutation)
	}
	if err := service.DeleteAccountTransaction(context.Background(), accountID, transactionID); err != ErrImportedMutation {
		t.Fatalf("DeleteAccountTransaction() error = %v, want %v", err, ErrImportedMutation)
	}
	if repository.updated.TransactionID != uuid.Nil {
		t.Fatalf("updated transaction id = %s, want nil", repository.updated.TransactionID)
	}
	if repository.deleted {
		t.Fatal("repository delete was called for imported transaction")
	}
}

func TestTransactionsWithExternalIDsAreReadOnly(t *testing.T) {
	externalID := "broker-row-1"
	value := Transaction{Source: SourceManual, ExternalID: &externalID}
	if !readOnlyTransaction(value) {
		t.Fatal("readOnlyTransaction() = false, want true for an external transaction")
	}
}

func TestUnsupportedManualTransactionCannotBeMutatedThroughGuidedCRUD(t *testing.T) {
	workspaceID := uuid.New()
	portfolioID := uuid.New()
	accountID := uuid.New()
	transactionID := uuid.New()
	repository := &fakeTransactionRepository{transaction: Transaction{
		ID: transactionID, PortfolioID: portfolioID, AccountID: accountID, Type: TypeFXConversion, Source: SourceManual,
	}}
	service := NewService(fakeTransactionBootstrapper{result: transactionBootstrapResult(workspaceID, portfolioID)}, repository)
	amount := decimal.NewFromInt(100)

	_, err := service.UpdateAccountTransaction(context.Background(), UpdateGuidedInput{
		TransactionID: transactionID,
		GuidedInput: GuidedInput{
			AccountID: accountID, Type: TypeDeposit, TradeDate: time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
			Currency: "CAD", Amount: &amount,
		},
	})
	if err != ErrUnsupportedMutation {
		t.Fatalf("UpdateAccountTransaction() error = %v, want %v", err, ErrUnsupportedMutation)
	}
	if err := service.DeleteAccountTransaction(context.Background(), accountID, transactionID); err != ErrUnsupportedMutation {
		t.Fatalf("DeleteAccountTransaction() error = %v, want %v", err, ErrUnsupportedMutation)
	}
	if repository.deleted {
		t.Fatal("repository delete was called for an unsupported transaction type")
	}
}

func TestFitsLedgerDecimalAcceptsRepresentableTrailingZeros(t *testing.T) {
	value := decimal.RequireFromString("1.2300000000000")
	if !fitsLedgerDecimal(value) {
		t.Fatalf("fitsLedgerDecimal(%s) = false, want true", value)
	}
}

type fakeTransactionBootstrapper struct {
	result bootstrap.Result
	err    error
}

func (b fakeTransactionBootstrapper) BootstrapLocal(context.Context) (bootstrap.Result, error) {
	return b.result, b.err
}

type fakeTransactionRepository struct {
	input        createRepositoryInput
	updated      updateRepositoryInput
	transaction  Transaction
	transactions []AccountTransaction
	createdID    uuid.UUID
	createCalls  int
	deleted      bool
	err          error
}

func (r *fakeTransactionRepository) CreateWithEntries(_ context.Context, input createRepositoryInput) (repositoryResult, error) {
	r.input = input
	r.createCalls++
	if r.err != nil {
		return repositoryResult{}, r.err
	}
	created := Transaction{
		ID:          r.createdID,
		PortfolioID: input.PortfolioID,
		AccountID:   input.AccountID,
		Type:        input.Type,
		TradeDate:   input.TradeDate,
		Source:      input.Source,
		Status:      StatusConfirmed,
	}
	return repositoryResult{Transaction: created, AccountTransaction: &AccountTransaction{Transaction: created}}, nil
}

func (r *fakeTransactionRepository) ListAccountTransactions(_ context.Context, portfolioID uuid.UUID, accountID uuid.UUID) ([]AccountTransaction, error) {
	if r.err != nil {
		return nil, r.err
	}
	if r.transactions != nil {
		return r.transactions, nil
	}
	id := r.createdID
	if id == uuid.Nil {
		id = uuid.New()
	}
	return []AccountTransaction{{
		Transaction: Transaction{
			ID:          id,
			PortfolioID: portfolioID,
			AccountID:   accountID,
			Type:        r.input.Type,
			TradeDate:   r.input.TradeDate,
			Source:      r.input.Source,
			Status:      StatusConfirmed,
		},
	}}, nil
}

func (r *fakeTransactionRepository) GetAccountTransaction(_ context.Context, portfolioID uuid.UUID, accountID uuid.UUID, transactionID uuid.UUID) (Transaction, error) {
	if r.err != nil {
		return Transaction{}, r.err
	}
	if r.transaction.ID != uuid.Nil {
		return r.transaction, nil
	}
	return Transaction{ID: transactionID, PortfolioID: portfolioID, AccountID: accountID, Source: SourceManual, Status: StatusConfirmed}, nil
}

func (r *fakeTransactionRepository) UpdateWithEntries(_ context.Context, input updateRepositoryInput) (repositoryResult, error) {
	r.updated = input
	if r.err != nil {
		return repositoryResult{}, r.err
	}
	updated := Transaction{ID: input.TransactionID, PortfolioID: input.PortfolioID, AccountID: input.AccountID, Type: input.Type, TradeDate: input.TradeDate, Source: SourceManual, Status: StatusConfirmed}
	return repositoryResult{Transaction: updated, AccountTransaction: &AccountTransaction{Transaction: updated}}, nil
}

func (r *fakeTransactionRepository) Delete(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error {
	r.deleted = true
	return r.err
}

func transactionBootstrapResult(workspaceID uuid.UUID, portfolioID uuid.UUID) bootstrap.Result {
	return bootstrap.Result{
		User: identity.User{ID: uuid.New(), Email: "local@finsight.local", DisplayName: "Local User"},
		Workspace: identity.Workspace{
			ID:           workspaceID,
			Name:         "Local Workspace",
			BaseCurrency: "CAD",
			AuthMode:     "local",
		},
		Portfolio: portfolio.Portfolio{
			ID:           portfolioID,
			WorkspaceID:  workspaceID,
			Name:         "Default Portfolio",
			BaseCurrency: "CAD",
			IsDefault:    true,
		},
	}
}
