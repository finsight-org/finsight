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
	stockID := uuid.MustParse("66666666-6666-6666-6666-666666666666")
	cashID := uuid.MustParse("77777777-7777-7777-7777-777777777777")
	repository := &fakeTransactionRepository{createdID: uuid.MustParse("88888888-8888-8888-8888-888888888888")}
	service := NewServiceWithAssets(
		fakeTransactionBootstrapper{result: transactionBootstrapResult(workspaceID, portfolioID)},
		repository,
		&fakeAssetRegistry{
			assetsByType: map[asset.Type]asset.Asset{
				asset.TypeEquity: {ID: stockID, Name: "Circle", Type: asset.TypeEquity, Currency: "CAD", Symbol: "CRCL"},
				asset.TypeCash:   {ID: cashID, Name: "CAD Cash", Type: asset.TypeCash, Currency: "CAD", Symbol: "CAD"},
			},
		},
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
}

func TestRecordAccountTransactionValidatesBeforeAssetUpsert(t *testing.T) {
	workspaceID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	accountID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	assets := &fakeAssetRegistry{}
	service := NewServiceWithAssets(
		fakeTransactionBootstrapper{result: transactionBootstrapResult(workspaceID, portfolioID)},
		&fakeTransactionRepository{},
		assets,
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
	if assets.upsertCount != 0 {
		t.Fatalf("asset upserts = %d, want 0", assets.upsertCount)
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
	input     createRepositoryInput
	updated   updateRepositoryInput
	createdID uuid.UUID
	err       error
}

func (r *fakeTransactionRepository) CreateWithEntries(_ context.Context, input createRepositoryInput) (Transaction, error) {
	r.input = input
	if r.err != nil {
		return Transaction{}, r.err
	}
	return Transaction{
		ID:          r.createdID,
		PortfolioID: input.PortfolioID,
		AccountID:   input.AccountID,
		Type:        input.Type,
		TradeDate:   input.TradeDate,
		Source:      input.Source,
		Status:      StatusConfirmed,
	}, nil
}

func (r *fakeTransactionRepository) ListAccountTransactions(_ context.Context, portfolioID uuid.UUID, accountID uuid.UUID) ([]AccountTransaction, error) {
	if r.err != nil {
		return nil, r.err
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

func (r *fakeTransactionRepository) ValidateAccount(context.Context, uuid.UUID, uuid.UUID) error {
	return r.err
}

func (r *fakeTransactionRepository) ValidateAccountTransaction(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error {
	return r.err
}

func (r *fakeTransactionRepository) UpdateWithEntries(_ context.Context, input updateRepositoryInput) (Transaction, error) {
	r.updated = input
	if r.err != nil {
		return Transaction{}, r.err
	}
	return Transaction{ID: input.TransactionID, PortfolioID: input.PortfolioID, AccountID: input.AccountID, Type: input.Type, TradeDate: input.TradeDate, Status: StatusConfirmed}, nil
}

func (r *fakeTransactionRepository) Delete(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error {
	return r.err
}

type fakeAssetRegistry struct {
	assetsByType map[asset.Type]asset.Asset
	upsertCount  int
	err          error
}

func (r *fakeAssetRegistry) UpsertAsset(_ context.Context, input asset.UpsertInput) (asset.Asset, error) {
	r.upsertCount++
	if r.err != nil {
		return asset.Asset{}, r.err
	}
	if value, ok := r.assetsByType[input.Type]; ok {
		return value, nil
	}
	return asset.Asset{ID: uuid.New(), Name: input.Name, Type: input.Type, Currency: input.Currency, Symbol: input.Symbol}, nil
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
