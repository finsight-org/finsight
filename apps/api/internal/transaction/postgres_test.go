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

func TestPostgresRepositoryDerivesWorkspaceFromPortfolioForAssetValidation(t *testing.T) {
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
