package transaction

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/finsight-org/finsight/apps/api/internal/postgres"
	"github.com/finsight-org/finsight/apps/api/migrations"
)

func TestRecorderConstraintTranslation(t *testing.T) {
	tests := []struct {
		name       string
		constraint string
		translate  func(error) error
		want       error
	}{
		{name: "transaction type", constraint: transactionTypeConstraint, translate: translateTransactionError, want: ErrInvalidType},
		{name: "transaction source", constraint: transactionSourceConstraint, translate: translateTransactionError, want: ErrInvalidSource},
		{name: "transaction account", constraint: transactionAccountConstraint, translate: translateTransactionError, want: ErrInvalidAccount},
		{name: "entry type", constraint: ledgerEntryTypeConstraint, translate: translateLedgerEntryError, want: ErrInvalidEntryType},
		{name: "entry currency", constraint: ledgerEntryCurrencyConstraint, translate: translateLedgerEntryError, want: ErrInvalidEntryCurrency},
		{name: "entry original currency", constraint: ledgerEntryOriginalCurrencyConstraint, translate: translateLedgerEntryError, want: ErrInvalidEntryCurrency},
		{name: "entry asset", constraint: ledgerEntryAssetConstraint, translate: translateLedgerEntryError, want: ErrInvalidEntryAsset},
		{name: "entry direction", constraint: ledgerEntryDirectionConstraint, translate: translateLedgerEntryError, want: ErrInvalidLedgerEntry},
		{name: "entry account", constraint: ledgerEntryAccountConstraint, translate: translateLedgerEntryError, want: ErrInvalidLedgerEntry},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			databaseErr := fmt.Errorf("wrapped: %w", &pgconn.PgError{Code: "23514", ConstraintName: test.constraint})
			if err := test.translate(databaseErr); !errors.Is(err, test.want) {
				t.Fatalf("translate() error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestRecorderRejectsAccountOutsidePortfolio(t *testing.T) {
	pool := postgresTestPool(t)
	ctx := context.Background()
	workspaceID := insertTestWorkspace(t, ctx, pool)
	cleanupWorkspace(t, ctx, pool, workspaceID)
	portfolioID := insertTestPortfolio(t, ctx, pool, workspaceID)
	otherPortfolioID := insertTestPortfolio(t, ctx, pool, workspaceID)
	accountID := insertTestAccount(t, ctx, pool, otherPortfolioID)
	assetID := insertTestAsset(t, ctx, pool, workspaceID)

	_, err := New(pool).Record(ctx, portfolioID, CreateInput{
		AccountID: accountID,
		Type:      TypeOpeningBalance,
		TradeDate: time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
		Source:    "TEST",
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
		t.Fatalf("Record() error = %v, want %v", err, ErrInvalidAccount)
	}
}

func TestRecorderDerivesWorkspaceFromPortfolioForAssetValidation(t *testing.T) {
	pool := postgresTestPool(t)
	ctx := context.Background()
	workspaceID := insertTestWorkspace(t, ctx, pool)
	cleanupWorkspace(t, ctx, pool, workspaceID)
	otherWorkspaceID := insertTestWorkspace(t, ctx, pool)
	cleanupWorkspace(t, ctx, pool, otherWorkspaceID)
	portfolioID := insertTestPortfolio(t, ctx, pool, workspaceID)
	accountID := insertTestAccount(t, ctx, pool, portfolioID)
	assetID := insertTestAsset(t, ctx, pool, otherWorkspaceID)

	_, err := New(pool).Record(ctx, portfolioID, CreateInput{
		AccountID: accountID,
		Type:      TypeOpeningBalance,
		TradeDate: time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
		Source:    "TEST",
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
		t.Fatalf("Record() error = %v, want %v", err, ErrInvalidEntryAsset)
	}
}

func TestRecorderNormalizesAndPersistsTransaction(t *testing.T) {
	pool := postgresTestPool(t)
	ctx := context.Background()
	workspaceID := insertTestWorkspace(t, ctx, pool)
	cleanupWorkspace(t, ctx, pool, workspaceID)
	portfolioID := insertTestPortfolio(t, ctx, pool, workspaceID)
	accountID := insertTestAccount(t, ctx, pool, portfolioID)
	assetID := insertTestAsset(t, ctx, pool, workspaceID)
	externalID := "  " + uuid.NewString() + "  "

	created, err := New(pool).Record(ctx, portfolioID, CreateInput{
		AccountID:   accountID,
		Type:        TypeOpeningBalance,
		TradeDate:   time.Date(2026, 7, 8, 14, 30, 0, 0, time.FixedZone("EDT", -4*60*60)),
		Description: "  Opening balance  ",
		Source:      " test ",
		ExternalID:  &externalID,
		LedgerEntries: []CreateLedgerEntryInput{{
			AssetID:   assetID,
			EntryType: EntryTypeCash,
			Amount:    decimal.NewFromInt(100),
			Currency:  " CAD ",
			Direction: DirectionIncrease,
		}},
	})
	if err != nil {
		t.Fatalf("Record() error = %v", err)
	}
	if created.PortfolioID != portfolioID || created.AccountID != accountID || created.Source != "TEST" || created.Description != "Opening balance" {
		t.Fatalf("created transaction = %#v", created)
	}
	if created.ExternalID == nil || *created.ExternalID != externalID[2:len(externalID)-2] {
		t.Fatalf("external ID = %#v, want trimmed value", created.ExternalID)
	}
	if len(created.LedgerEntries) != 1 || created.LedgerEntries[0].Currency != "CAD" {
		t.Fatalf("ledger entries = %#v", created.LedgerEntries)
	}
}

func TestRecorderRollsBackWhenLedgerInsertFails(t *testing.T) {
	pool := postgresTestPool(t)
	ctx := context.Background()
	workspaceID := insertTestWorkspace(t, ctx, pool)
	cleanupWorkspace(t, ctx, pool, workspaceID)
	portfolioID := insertTestPortfolio(t, ctx, pool, workspaceID)
	accountID := insertTestAccount(t, ctx, pool, portfolioID)
	assetID := insertTestAsset(t, ctx, pool, workspaceID)
	externalID := uuid.NewString()

	_, err := New(pool).Record(ctx, portfolioID, CreateInput{
		AccountID:  accountID,
		Type:       TypeOpeningBalance,
		TradeDate:  time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC),
		Source:     "TEST",
		ExternalID: &externalID,
		LedgerEntries: []CreateLedgerEntryInput{{
			AssetID:   assetID,
			EntryType: EntryTypeCash,
			Amount:    decimal.RequireFromString("999999999999999999999999999"),
			Currency:  "CAD",
			Direction: DirectionIncrease,
		}},
	})
	if err == nil {
		t.Fatal("Record() error = nil, want ledger insert failure")
	}
	var count int
	if queryErr := pool.QueryRow(ctx, `select count(*) from transactions where portfolio_id = $1 and external_id = $2`, portfolioID, externalID).Scan(&count); queryErr != nil {
		t.Fatalf("count rolled-back transaction: %v", queryErr)
	}
	if count != 0 {
		t.Fatalf("transaction count = %d, want 0 after rollback", count)
	}
}

func postgresTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL, ok := os.LookupEnv("FINSIGHT_TEST_DATABASE_URL")
	if !ok || databaseURL == "" {
		t.Skip("FINSIGHT_TEST_DATABASE_URL is required for transaction integration tests")
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
		if _, err := pool.Exec(ctx, `delete from transactions where portfolio_id in (select id from portfolios where workspace_id = $1)`, workspaceID); err != nil {
			t.Fatalf("delete test transactions for workspace %s: %v", workspaceID, err)
		}
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
