package portfoliovalue

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/finsight-org/finsight/apps/api/internal/postgres"
	"github.com/finsight-org/finsight/apps/api/migrations"
)

func TestPostgresRepositoryLoadsRelevantFXRatesForValuation(t *testing.T) {
	pool := postgresTestPool(t)
	ctx := context.Background()
	workspaceID := insertTestWorkspace(t, ctx, pool)
	cleanupWorkspace(t, ctx, pool, workspaceID)
	portfolioID := insertTestPortfolio(t, ctx, pool, workspaceID)
	accountID := insertTestAccount(t, ctx, pool, portfolioID)
	usdCashID := insertTestAsset(t, ctx, pool, workspaceID, "CASH", "USD")

	insertTestTransactionWithCashEntry(t, ctx, pool, portfolioID, accountID, usdCashID, "USD")
	insertTestFXRate(t, ctx, pool, workspaceID, "USD", "CAD", "2026-07-01", "1.35")
	insertTestFXRate(t, ctx, pool, workspaceID, "EUR", "CAD", "2026-07-01", "1.50")

	data, err := NewPostgresRepository(pool).LoadValuationData(ctx, workspaceID, portfolioID, "CAD", mustDate("2026-07-07"))
	if err != nil {
		t.Fatalf("LoadValuationData() error = %v", err)
	}
	if len(data.FXRates) != 1 {
		t.Fatalf("fx rate count = %d, want 1", len(data.FXRates))
	}
	if data.FXRates[0].FromCurrency != "USD" || data.FXRates[0].ToCurrency != "CAD" {
		t.Fatalf("fx rate = %#v, want USD to CAD", data.FXRates[0])
	}
}

func TestFXRateConstraintsRejectInvalidCurrencyAndRate(t *testing.T) {
	pool := postgresTestPool(t)
	ctx := context.Background()
	workspaceID := insertTestWorkspace(t, ctx, pool)
	cleanupWorkspace(t, ctx, pool, workspaceID)

	_, err := pool.Exec(ctx, `
insert into fx_rates (workspace_id, from_currency, to_currency, date, rate, provider_id, source_quality)
values ($1, 'usd', 'CAD', '2026-07-01', 1.35, 'test', 'MANUAL')
`, workspaceID)
	if err == nil {
		t.Fatal("insert invalid currency error = nil, want error")
	}

	_, err = pool.Exec(ctx, `
insert into fx_rates (workspace_id, from_currency, to_currency, date, rate, provider_id, source_quality)
values ($1, 'USD', 'CAD', '2026-07-01', 0, 'test', 'MANUAL')
`, workspaceID)
	if err == nil {
		t.Fatal("insert zero rate error = nil, want error")
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

func insertTestAsset(t *testing.T, ctx context.Context, pool *pgxpool.Pool, workspaceID uuid.UUID, assetType string, currency string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	suffix := uuid.NewString()
	err := pool.QueryRow(ctx, `
insert into assets (workspace_id, name, asset_type, currency, symbol, provider_id, provider_symbol)
values ($1, $2, $3, $4, $5, 'test', $6)
returning id
`, workspaceID, "Test Asset "+suffix, assetType, currency, currency, fmt.Sprintf("test:%s", suffix)).Scan(&id)
	if err != nil {
		t.Fatalf("insert asset: %v", err)
	}
	return id
}

func insertTestTransactionWithCashEntry(t *testing.T, ctx context.Context, pool *pgxpool.Pool, portfolioID uuid.UUID, accountID uuid.UUID, assetID uuid.UUID, currency string) {
	t.Helper()
	var transactionID uuid.UUID
	err := pool.QueryRow(ctx, `
insert into transactions (portfolio_id, account_id, type, trade_date, description, source, status)
values ($1, $2, 'OPENING_BALANCE', '2026-07-01', 'Test cash', 'TEST', 'CONFIRMED')
returning id
`, portfolioID, accountID).Scan(&transactionID)
	if err != nil {
		t.Fatalf("insert transaction: %v", err)
	}
	_, err = pool.Exec(ctx, `
insert into ledger_entries (transaction_id, account_id, asset_id, entry_type, amount, currency, direction)
values ($1, $2, $3, 'CASH', 100, $4, 'INCREASE')
`, transactionID, accountID, assetID, currency)
	if err != nil {
		t.Fatalf("insert ledger entry: %v", err)
	}
}

func insertTestFXRate(t *testing.T, ctx context.Context, pool *pgxpool.Pool, workspaceID uuid.UUID, fromCurrency string, toCurrency string, rateDate string, rate string) {
	t.Helper()
	_, err := pool.Exec(ctx, `
insert into fx_rates (workspace_id, from_currency, to_currency, date, rate, provider_id, source_quality)
values ($1, $2, $3, $4, $5, 'test', 'MANUAL')
`, workspaceID, fromCurrency, toCurrency, rateDate, rate)
	if err != nil {
		t.Fatalf("insert fx rate: %v", err)
	}
}

func mustDate(value string) time.Time {
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		panic(err)
	}
	return parsed
}
