package demo

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/finsight-org/finsight/apps/api/internal/asset"
	"github.com/finsight-org/finsight/apps/api/internal/postgres"
	database "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
	"github.com/finsight-org/finsight/apps/api/internal/transaction"
	"github.com/finsight-org/finsight/apps/api/migrations"
)

func TestSeederIsIdempotentAndPreservesNonDemoRecords(t *testing.T) {
	pool := demoTestPool(t)
	ctx := context.Background()
	workspaceID, portfolioID := insertDemoTestScope(t, ctx, pool)
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `delete from transactions where portfolio_id = $1`, portfolioID); err != nil {
			t.Fatalf("delete demo test transactions: %v", err)
		}
		if _, err := pool.Exec(ctx, `delete from workspaces where id = $1`, workspaceID); err != nil {
			t.Fatalf("delete demo test workspace: %v", err)
		}
	})
	insertNonDemoRecords(t, ctx, pool, portfolioID)
	queries := database.New(pool)
	seeder := NewSeeder(asset.NewStore(queries), transaction.New(pool), queries)

	if err := seeder.Seed(ctx, workspaceID, portfolioID); err != nil {
		t.Fatalf("first Seed() error = %v", err)
	}
	if err := seeder.Seed(ctx, workspaceID, portfolioID); err != nil {
		t.Fatalf("second Seed() error = %v", err)
	}

	assertDemoCount(t, ctx, pool, `select count(*) from accounts where portfolio_id = $1`, portfolioID, 3)
	assertDemoCount(t, ctx, pool, `select count(*) from transactions where portfolio_id = $1 and source = 'DEMO'`, portfolioID, 8)
	assertDemoCount(t, ctx, pool, `select count(*) from transactions where portfolio_id = $1 and source = 'MANUAL'`, portfolioID, 1)
	assertDemoCount(t, ctx, pool, `select count(*) from assets where workspace_id = $1 and provider_id = 'demo'`, workspaceID, 5)
	assertDemoCount(t, ctx, pool, `select count(*) from market_prices mp join assets a on a.id = mp.asset_id where a.workspace_id = $1 and mp.provider_id = 'demo'`, workspaceID, 18)
	assertDemoCount(t, ctx, pool, `select count(*) from fx_rates where workspace_id = $1 and provider_id = 'demo'`, workspaceID, 7)
}

func assertDemoCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, query string, id uuid.UUID, want int) {
	t.Helper()
	var count int
	if err := pool.QueryRow(ctx, query, id).Scan(&count); err != nil {
		t.Fatalf("count records: %v", err)
	}
	if count != want {
		t.Fatalf("count = %d, want %d for %q", count, want, query)
	}
}

func insertDemoTestScope(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (uuid.UUID, uuid.UUID) {
	t.Helper()
	var workspaceID uuid.UUID
	if err := pool.QueryRow(ctx, `insert into workspaces (name, base_currency, auth_mode) values ($1, 'CAD', $2) returning id`, "Demo Test "+uuid.NewString(), "test-"+uuid.NewString()).Scan(&workspaceID); err != nil {
		t.Fatalf("insert workspace: %v", err)
	}
	var portfolioID uuid.UUID
	if err := pool.QueryRow(ctx, `insert into portfolios (workspace_id, name, base_currency, is_default) values ($1, $2, 'CAD', false) returning id`, workspaceID, "Demo Portfolio "+uuid.NewString()).Scan(&portfolioID); err != nil {
		t.Fatalf("insert portfolio: %v", err)
	}
	return workspaceID, portfolioID
}

func insertNonDemoRecords(t *testing.T, ctx context.Context, pool *pgxpool.Pool, portfolioID uuid.UUID) {
	t.Helper()
	var accountID uuid.UUID
	if err := pool.QueryRow(ctx, `insert into accounts (portfolio_id, name, type, base_currency, external_reference) values ($1, $2, 'BROKERAGE', 'CAD', $3) returning id`, portfolioID, "Manual Account "+uuid.NewString(), "manual:"+uuid.NewString()).Scan(&accountID); err != nil {
		t.Fatalf("insert manual account: %v", err)
	}
	if _, err := pool.Exec(ctx, `insert into transactions (portfolio_id, account_id, type, trade_date, description, source, external_id, status) values ($1, $2, 'ADJUSTMENT', '2026-01-01', 'Manual record', 'MANUAL', $3, 'CONFIRMED')`, portfolioID, accountID, "manual:"+uuid.NewString()); err != nil {
		t.Fatalf("insert manual transaction: %v", err)
	}
}

func demoTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("FINSIGHT_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("FINSIGHT_TEST_DATABASE_URL is required for demo integration tests")
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
