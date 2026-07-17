package transaction

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/finsight-org/finsight/apps/api/internal/asset"
	"github.com/finsight-org/finsight/apps/api/internal/postgres"
	"github.com/finsight-org/finsight/apps/api/migrations"
)

func TestPostgresRepositoryRejectsAccountOutsidePortfolio(t *testing.T) {
	pool := postgresTestPool(t)
	ctx := context.Background()
	workspaceID := insertTestWorkspace(t, ctx, pool)
	cleanupWorkspace(t, ctx, pool, workspaceID)
	portfolioID := insertTestPortfolio(t, ctx, pool, workspaceID)
	otherPortfolioID := insertTestPortfolio(t, ctx, pool, workspaceID)
	accountID := insertTestAccount(t, ctx, pool, otherPortfolioID)
	assetID := insertTestAsset(t, ctx, pool, workspaceID)

	_, err := NewPostgresRepository(pool).CreateWithEntries(ctx, createRepositoryInput{
		WorkspaceID: workspaceID,
		PortfolioID: portfolioID,
		AccountID:   accountID,
		Type:        TypeOpeningBalance,
		TradeDate:   time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
		Source:      "TEST",
		LedgerEntries: []CreateLedgerEntryInput{
			{
				AssetID:   assetID,
				EntryType: EntryTypeCash,
				Amount:    decimal.NewFromInt(100),
				Currency:  "CAD",
				Direction: DirectionIncrease,
			},
		},
	})
	if !errors.Is(err, ErrInvalidAccount) {
		t.Fatalf("CreateWithEntries() error = %v, want %v", err, ErrInvalidAccount)
	}
}

func TestPostgresRepositoryRejectsAssetOutsideWorkspace(t *testing.T) {
	pool := postgresTestPool(t)
	ctx := context.Background()
	workspaceID := insertTestWorkspace(t, ctx, pool)
	cleanupWorkspace(t, ctx, pool, workspaceID)
	otherWorkspaceID := insertTestWorkspace(t, ctx, pool)
	cleanupWorkspace(t, ctx, pool, otherWorkspaceID)
	portfolioID := insertTestPortfolio(t, ctx, pool, workspaceID)
	accountID := insertTestAccount(t, ctx, pool, portfolioID)
	assetID := insertTestAsset(t, ctx, pool, otherWorkspaceID)

	_, err := NewPostgresRepository(pool).CreateWithEntries(ctx, createRepositoryInput{
		WorkspaceID: workspaceID,
		PortfolioID: portfolioID,
		AccountID:   accountID,
		Type:        TypeOpeningBalance,
		TradeDate:   time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
		Source:      "TEST",
		LedgerEntries: []CreateLedgerEntryInput{
			{
				AssetID:   assetID,
				EntryType: EntryTypeAssetQuantity,
				Quantity:  decimal.NewFromInt(1),
				Currency:  "CAD",
				Direction: DirectionIncrease,
			},
		},
	})
	if !errors.Is(err, ErrInvalidEntryAsset) {
		t.Fatalf("CreateWithEntries() error = %v, want %v", err, ErrInvalidEntryAsset)
	}
}

func TestSummarizeAccountTransactionPreservesZeroSellCashImpact(t *testing.T) {
	stock := asset.Asset{ID: uuid.New(), Type: asset.TypeEquity, Currency: "CAD", Symbol: "CRCL"}
	cash := asset.Asset{ID: uuid.New(), Type: asset.TypeCash, Currency: "CAD", Symbol: "CAD"}
	value := AccountTransaction{
		Transaction: Transaction{Type: TypeSell, Source: SourceManual},
		Entries: []AccountLedgerEntry{
			{LedgerEntry: LedgerEntry{EntryType: EntryTypeAssetQuantity, Quantity: decimal.NewFromInt(-2), Currency: "CAD"}, Asset: stock},
			{LedgerEntry: LedgerEntry{EntryType: EntryTypeCash, Amount: decimal.Zero, Currency: "CAD"}, Asset: cash},
			{LedgerEntry: LedgerEntry{EntryType: EntryTypeFee, Amount: decimal.NewFromInt(20), Currency: "CAD"}, Asset: cash},
		},
	}

	summarizeAccountTransaction(&value)

	if value.CashImpact == nil || !value.CashImpact.IsZero() {
		t.Fatalf("cash impact = %v, want explicit zero", value.CashImpact)
	}
	if value.Price == nil || !value.Price.Equal(decimal.NewFromInt(10)) {
		t.Fatalf("price = %v, want 10", value.Price)
	}
}

func TestSummarizeAccountTransactionDoesNotCombineCurrencies(t *testing.T) {
	cad := asset.Asset{ID: uuid.New(), Type: asset.TypeCash, Currency: "CAD", Symbol: "CAD"}
	usd := asset.Asset{ID: uuid.New(), Type: asset.TypeCash, Currency: "USD", Symbol: "USD"}
	value := AccountTransaction{
		Transaction: Transaction{Type: TypeFXConversion, Source: "CSV_IMPORT"},
		Entries: []AccountLedgerEntry{
			{LedgerEntry: LedgerEntry{EntryType: EntryTypeCash, Amount: decimal.NewFromInt(-75), Currency: "USD"}, Asset: usd},
			{LedgerEntry: LedgerEntry{EntryType: EntryTypeCash, Amount: decimal.NewFromInt(100), Currency: "CAD"}, Asset: cad},
		},
	}

	summarizeAccountTransaction(&value)

	if value.CashImpact != nil {
		t.Fatalf("cash impact = %s, want nil for mixed currencies", value.CashImpact)
	}
	if value.Currency != "CAD" {
		t.Fatalf("currency = %q, want deterministic first cash currency CAD", value.Currency)
	}
	if value.Editable {
		t.Fatal("editable = true, want false for imported transaction")
	}
}

func TestSummarizeAccountTransactionDoesNotExposeUnsupportedManualTypeAsEditable(t *testing.T) {
	value := AccountTransaction{Transaction: Transaction{Type: TypeFXConversion, Source: SourceManual}}

	summarizeAccountTransaction(&value)

	if value.Editable {
		t.Fatal("editable = true, want false for a transaction the guided form cannot represent")
	}
}

func TestPostgresRepositoryRollsBackGuidedAssetUpsertsOnFailure(t *testing.T) {
	pool := postgresTestPool(t)
	ctx := context.Background()
	workspaceID := insertTestWorkspace(t, ctx, pool)
	cleanupWorkspace(t, ctx, pool, workspaceID)
	portfolioID := insertTestPortfolio(t, ctx, pool, workspaceID)
	accountID := insertTestAccount(t, ctx, pool, portfolioID)
	providerSymbol := "rollback:" + uuid.NewString()

	_, err := NewPostgresRepository(pool).CreateWithEntries(ctx, createRepositoryInput{
		WorkspaceID: workspaceID,
		PortfolioID: portfolioID,
		AccountID:   accountID,
		Type:        TypeDeposit,
		TradeDate:   time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
		Source:      SourceManual,
		AssetUpserts: []repositoryAssetUpsert{{
			Reference: ledgerAssetCash,
			Input: asset.UpsertInput{
				Name:           "CAD Cash",
				Type:           asset.TypeCash,
				Currency:       "CAD",
				Symbol:         "CAD",
				ProviderID:     "test",
				ProviderSymbol: providerSymbol,
			},
		}},
		LedgerEntries: []CreateLedgerEntryInput{{
			assetReference: ledgerAssetCash,
			EntryType:      EntryTypeCash,
			Amount:         decimal.NewFromInt(100),
			Currency:       "USD",
			Direction:      DirectionIncrease,
		}},
	})
	if !errors.Is(err, ErrInvalidEntryCurrency) {
		t.Fatalf("CreateWithEntries() error = %v, want %v", err, ErrInvalidEntryCurrency)
	}

	var count int
	if err := pool.QueryRow(ctx, `select count(*) from assets where workspace_id = $1 and provider_id = 'test' and provider_symbol = $2`, workspaceID, providerSymbol).Scan(&count); err != nil {
		t.Fatalf("count rolled back asset: %v", err)
	}
	if count != 0 {
		t.Fatalf("asset count = %d, want 0 after rollback", count)
	}
}

func TestPostgresRepositoryUpdateReplacesEntriesAndDeleteCascades(t *testing.T) {
	pool := postgresTestPool(t)
	ctx := context.Background()
	workspaceID := insertTestWorkspace(t, ctx, pool)
	cleanupWorkspace(t, ctx, pool, workspaceID)
	portfolioID := insertTestPortfolio(t, ctx, pool, workspaceID)
	accountID := insertTestAccount(t, ctx, pool, portfolioID)
	assetID := insertTestAsset(t, ctx, pool, workspaceID)
	repository := NewPostgresRepository(pool)

	created, err := repository.CreateWithEntries(ctx, createRepositoryInput{
		WorkspaceID: workspaceID,
		PortfolioID: portfolioID,
		AccountID:   accountID,
		Type:        TypeBuy,
		TradeDate:   time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
		Description: "Original buy",
		Source:      SourceManual,
		LedgerEntries: []CreateLedgerEntryInput{{
			AssetID:   assetID,
			EntryType: EntryTypeAssetQuantity,
			Quantity:  decimal.NewFromInt(2),
			Currency:  "CAD",
			Direction: DirectionIncrease,
		}},
	})
	if err != nil {
		t.Fatalf("CreateWithEntries() error = %v", err)
	}

	_, err = repository.UpdateWithEntries(ctx, updateRepositoryInput{
		WorkspaceID:   workspaceID,
		PortfolioID:   portfolioID,
		AccountID:     accountID,
		TransactionID: created.Transaction.ID,
		Type:          TypeBuy,
		TradeDate:     time.Date(2026, 7, 9, 0, 0, 0, 0, time.UTC),
		Description:   "Corrected buy",
		LedgerEntries: []CreateLedgerEntryInput{{
			AssetID:   assetID,
			EntryType: EntryTypeAssetQuantity,
			Quantity:  decimal.NewFromInt(3),
			Currency:  "CAD",
			Direction: DirectionIncrease,
		}},
	})
	if err != nil {
		t.Fatalf("UpdateWithEntries() error = %v", err)
	}

	var description, quantity string
	var entryCount int
	if err := pool.QueryRow(ctx, `
select tx.description, le.quantity::text, count(*) over ()
from transactions tx
join ledger_entries le on le.transaction_id = tx.id
where tx.id = $1
`, created.Transaction.ID).Scan(&description, &quantity, &entryCount); err != nil {
		t.Fatalf("select updated transaction: %v", err)
	}
	if description != "Corrected buy" || quantity != "3.000000000000" || entryCount != 1 {
		t.Fatalf("updated transaction = description %q, quantity %q, entries %d", description, quantity, entryCount)
	}

	if err := repository.Delete(ctx, portfolioID, accountID, created.Transaction.ID); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	var transactionCount, ledgerEntryCount int
	if err := pool.QueryRow(ctx, `select count(*) from transactions where id = $1`, created.Transaction.ID).Scan(&transactionCount); err != nil {
		t.Fatalf("count deleted transaction: %v", err)
	}
	if err := pool.QueryRow(ctx, `select count(*) from ledger_entries where transaction_id = $1`, created.Transaction.ID).Scan(&ledgerEntryCount); err != nil {
		t.Fatalf("count cascaded ledger entries: %v", err)
	}
	if transactionCount != 0 || ledgerEntryCount != 0 {
		t.Fatalf("remaining rows = transactions %d, ledger entries %d", transactionCount, ledgerEntryCount)
	}
}

func TestPostgresRepositoryDeleteRejectsReadOnlyTransaction(t *testing.T) {
	pool := postgresTestPool(t)
	ctx := context.Background()
	workspaceID := insertTestWorkspace(t, ctx, pool)
	cleanupWorkspace(t, ctx, pool, workspaceID)
	portfolioID := insertTestPortfolio(t, ctx, pool, workspaceID)
	accountID := insertTestAccount(t, ctx, pool, portfolioID)
	assetID := insertTestAsset(t, ctx, pool, workspaceID)
	externalID := "imported:" + uuid.NewString()
	repository := NewPostgresRepository(pool)

	created, err := repository.CreateWithEntries(ctx, createRepositoryInput{
		WorkspaceID: workspaceID,
		PortfolioID: portfolioID,
		AccountID:   accountID,
		Type:        TypeOpeningBalance,
		TradeDate:   time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
		Source:      SourceManual,
		ExternalID:  &externalID,
		LedgerEntries: []CreateLedgerEntryInput{{
			AssetID:   assetID,
			EntryType: EntryTypeAssetQuantity,
			Quantity:  decimal.NewFromInt(1),
			Currency:  "CAD",
			Direction: DirectionIncrease,
		}},
	})
	if err != nil {
		t.Fatalf("CreateWithEntries() error = %v", err)
	}

	err = repository.Delete(ctx, portfolioID, accountID, created.Transaction.ID)
	if !errors.Is(err, ErrImportedMutation) {
		t.Fatalf("Delete() error = %v, want %v", err, ErrImportedMutation)
	}
	var count int
	if err := pool.QueryRow(ctx, `select count(*) from transactions where id = $1`, created.Transaction.ID).Scan(&count); err != nil {
		t.Fatalf("count preserved transaction: %v", err)
	}
	if count != 1 {
		t.Fatalf("transaction count = %d, want 1", count)
	}
	if _, err := pool.Exec(ctx, `delete from transactions where id = $1`, created.Transaction.ID); err != nil {
		t.Fatalf("delete preserved transaction fixture: %v", err)
	}
}

func postgresTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL, ok := os.LookupEnv("FINSIGHT_TEST_DATABASE_URL")
	if !ok || databaseURL == "" {
		t.Skip("FINSIGHT_TEST_DATABASE_URL is required for Postgres repository tests")
	}
	ctx := context.Background()
	if err := postgres.RunMigrations(ctx, databaseURL, migrations.Files); err != nil {
		t.Fatalf("RunMigrations() error = %v", err)
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("pgxpool.New() error = %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func cleanupWorkspace(t *testing.T, ctx context.Context, pool *pgxpool.Pool, workspaceID uuid.UUID) {
	t.Helper()
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `delete from workspaces where id = $1`, workspaceID); err != nil {
			t.Fatalf("delete test workspace %s: %v", workspaceID, err)
		}
	})
}

func insertTestWorkspace(t *testing.T, ctx context.Context, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
insert into workspaces (name, base_currency, auth_mode)
values ($1, 'CAD', $2)
returning id
`, "Test Workspace "+uuid.NewString(), "test-"+uuid.NewString()).Scan(&id)
	if err != nil {
		t.Fatalf("insert workspace: %v", err)
	}
	return id
}

func insertTestPortfolio(t *testing.T, ctx context.Context, pool *pgxpool.Pool, workspaceID uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
insert into portfolios (workspace_id, name, base_currency, is_default)
values ($1, $2, 'CAD', false)
returning id
`, workspaceID, "Test Portfolio "+uuid.NewString()).Scan(&id)
	if err != nil {
		t.Fatalf("insert portfolio: %v", err)
	}
	return id
}

func insertTestAccount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, portfolioID uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
insert into accounts (portfolio_id, name, type, base_currency)
values ($1, $2, 'BROKERAGE', 'CAD')
returning id
`, portfolioID, "Test Account "+uuid.NewString()).Scan(&id)
	if err != nil {
		t.Fatalf("insert account: %v", err)
	}
	return id
}

func insertTestAsset(t *testing.T, ctx context.Context, pool *pgxpool.Pool, workspaceID uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	suffix := uuid.NewString()
	err := pool.QueryRow(ctx, `
insert into assets (workspace_id, name, asset_type, currency, symbol, provider_id, provider_symbol)
values ($1, $2, 'EQUITY', 'CAD', $3, 'test', $4)
returning id
`, workspaceID, "Test Asset "+suffix, "TST", fmt.Sprintf("test:%s", suffix)).Scan(&id)
	if err != nil {
		t.Fatalf("insert asset: %v", err)
	}
	return id
}
