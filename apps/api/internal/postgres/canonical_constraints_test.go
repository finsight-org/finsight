package postgres

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/finsight-org/finsight/apps/api/migrations"
)

func TestCanonicalIdentityAndPortfolioConstraints(t *testing.T) {
	pool := canonicalTestPool(t)
	ctx := context.Background()
	workspaceID, _, _, _, userID := insertCanonicalTestGraph(t, ctx, pool)
	cleanupCanonicalTestGraph(t, ctx, pool, workspaceID, userID)

	tests := []struct {
		name  string
		query string
		args  []any
	}{
		{name: "lowercase email", query: `insert into users (email, display_name) values ($1, 'Test User')`, args: []any{"UPPER-" + uuid.NewString() + "@example.com"}},
		{name: "trimmed email", query: `insert into users (email, display_name) values ($1, 'Test User')`, args: []any{" test-" + uuid.NewString() + "@example.com"}},
		{name: "nonempty display name", query: `insert into users (email, display_name) values ($1, '')`, args: []any{"test-" + uuid.NewString() + "@example.com"}},
		{name: "trimmed workspace name", query: `insert into workspaces (name, base_currency, auth_mode) values (' Workspace', 'CAD', $1)`, args: []any{"test-" + uuid.NewString()}},
		{name: "lowercase auth mode", query: `insert into workspaces (name, base_currency, auth_mode) values ('Workspace', 'CAD', $1)`, args: []any{"TEST-" + uuid.NewString()}},
		{name: "workspace currency", query: `insert into workspaces (name, base_currency, auth_mode) values ('Workspace', 'cad', $1)`, args: []any{"test-" + uuid.NewString()}},
		{name: "membership role", query: `insert into workspace_memberships (workspace_id, user_id, role) values ($1, $2, 'guest')`, args: []any{workspaceID, userID}},
		{name: "portfolio name", query: `insert into portfolios (workspace_id, name, base_currency) values ($1, '', 'CAD')`, args: []any{workspaceID}},
		{name: "portfolio description", query: `insert into portfolios (workspace_id, name, description, base_currency) values ($1, $2, ' padded ', 'CAD')`, args: []any{workspaceID, "Portfolio " + uuid.NewString()}},
		{name: "portfolio currency", query: `insert into portfolios (workspace_id, name, base_currency) values ($1, $2, 'cad')`, args: []any{workspaceID, "Portfolio " + uuid.NewString()}},
	}
	assertConstraintFailures(t, ctx, pool, tests)
}

func TestCanonicalAssetConstraints(t *testing.T) {
	pool := canonicalTestPool(t)
	ctx := context.Background()
	workspaceID, _, _, _, userID := insertCanonicalTestGraph(t, ctx, pool)
	cleanupCanonicalTestGraph(t, ctx, pool, workspaceID, userID)

	assetInsert := `insert into assets (workspace_id, name, asset_type, currency, symbol, provider_id, provider_symbol, exchange, isin, country, sector)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`
	tests := []struct {
		name  string
		query string
		args  []any
	}{
		{name: "name", query: assetInsert, args: []any{workspaceID, " Asset", "EQUITY", "CAD", "AST", "test", uuid.NewString(), nil, nil, nil, nil}},
		{name: "type", query: assetInsert, args: []any{workspaceID, "Asset", "BOND", "CAD", "AST", "test", uuid.NewString(), nil, nil, nil, nil}},
		{name: "currency", query: assetInsert, args: []any{workspaceID, "Asset", "EQUITY", "cad", "AST", "test", uuid.NewString(), nil, nil, nil, nil}},
		{name: "symbol", query: assetInsert, args: []any{workspaceID, "Asset", "EQUITY", "CAD", "AST ", "test", uuid.NewString(), nil, nil, nil, nil}},
		{name: "provider id", query: assetInsert, args: []any{workspaceID, "Asset", "EQUITY", "CAD", "AST", "Demo", uuid.NewString(), nil, nil, nil, nil}},
		{name: "provider symbol", query: assetInsert, args: []any{workspaceID, "Asset", "EQUITY", "CAD", "AST", "test", "UPPER", nil, nil, nil, nil}},
		{name: "exchange", query: assetInsert, args: []any{workspaceID, "Asset", "EQUITY", "CAD", "AST", "test", uuid.NewString(), "", nil, nil, nil}},
		{name: "isin", query: assetInsert, args: []any{workspaceID, "Asset", "EQUITY", "CAD", "AST", "test", uuid.NewString(), nil, " ISIN", nil, nil}},
		{name: "country", query: assetInsert, args: []any{workspaceID, "Asset", "EQUITY", "CAD", "AST", "test", uuid.NewString(), nil, nil, "", nil}},
		{name: "sector", query: assetInsert, args: []any{workspaceID, "Asset", "EQUITY", "CAD", "AST", "test", uuid.NewString(), nil, nil, nil, "Sector "}},
	}
	assertConstraintFailures(t, ctx, pool, tests)
}

func TestCanonicalTransactionAndLedgerConstraints(t *testing.T) {
	pool := canonicalTestPool(t)
	ctx := context.Background()
	workspaceID, portfolioID, accountID, assetID, userID := insertCanonicalTestGraph(t, ctx, pool)
	cleanupCanonicalTestGraph(t, ctx, pool, workspaceID, userID)

	transactionInsert := `insert into transactions (portfolio_id, account_id, type, trade_date, description, source, external_id, status)
values ($1, $2, $3, '2026-07-01', $4, $5, $6, $7)`
	tests := []struct {
		name  string
		query string
		args  []any
	}{
		{name: "type", query: transactionInsert, args: []any{portfolioID, accountID, "OTHER", "Description", "TEST", nil, "CONFIRMED"}},
		{name: "description", query: transactionInsert, args: []any{portfolioID, accountID, "ADJUSTMENT", " Description", "TEST", nil, "CONFIRMED"}},
		{name: "source", query: transactionInsert, args: []any{portfolioID, accountID, "ADJUSTMENT", "Description", "manual", nil, "CONFIRMED"}},
		{name: "external id", query: transactionInsert, args: []any{portfolioID, accountID, "ADJUSTMENT", "Description", "TEST", "", "CONFIRMED"}},
		{name: "status", query: transactionInsert, args: []any{portfolioID, accountID, "ADJUSTMENT", "Description", "TEST", nil, "PENDING"}},
	}
	assertConstraintFailures(t, ctx, pool, tests)

	var transactionID uuid.UUID
	if err := pool.QueryRow(ctx, transactionInsert+` returning id`, portfolioID, accountID, "ADJUSTMENT", "Constraint test", "TEST", "constraint:"+uuid.NewString(), "CONFIRMED").Scan(&transactionID); err != nil {
		t.Fatalf("insert valid transaction: %v", err)
	}

	ledgerInsert := `insert into ledger_entries (transaction_id, account_id, asset_id, entry_type, quantity, amount, currency, original_currency, direction)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`
	ledgerTests := []struct {
		name  string
		query string
		args  []any
	}{
		{name: "entry type", query: ledgerInsert, args: []any{transactionID, accountID, assetID, "OTHER", 0, 0, "CAD", nil, "INCREASE"}},
		{name: "currency", query: ledgerInsert, args: []any{transactionID, accountID, assetID, "CASH", 0, 0, "cad", nil, "INCREASE"}},
		{name: "original currency", query: ledgerInsert, args: []any{transactionID, accountID, assetID, "CASH", 0, 0, "CAD", "usd", "INCREASE"}},
		{name: "direction", query: ledgerInsert, args: []any{transactionID, accountID, assetID, "CASH", 0, 0, "CAD", nil, "SIDEWAYS"}},
	}
	assertConstraintFailures(t, ctx, pool, ledgerTests)

	if _, err := pool.Exec(ctx, ledgerInsert, transactionID, accountID, assetID, "ASSET_QUANTITY", 0, 123, "CAD", nil, "INCREASE"); err != nil {
		t.Fatalf("ledger entry without cross-field financial rules was rejected: %v", err)
	}
}

func TestCanonicalMarketDataConstraints(t *testing.T) {
	pool := canonicalTestPool(t)
	ctx := context.Background()
	workspaceID, _, _, assetID, userID := insertCanonicalTestGraph(t, ctx, pool)
	cleanupCanonicalTestGraph(t, ctx, pool, workspaceID, userID)

	marketPriceInsert := `insert into market_prices (asset_id, date, price, currency, provider_id, source_quality) values ($1, '2026-07-01', $2, $3, $4, $5)`
	fxRateInsert := `insert into fx_rates (workspace_id, from_currency, to_currency, date, rate, provider_id, source_quality) values ($1, $2, $3, '2026-07-01', $4, $5, $6)`
	tests := []struct {
		name  string
		query string
		args  []any
	}{
		{name: "market price positivity", query: marketPriceInsert, args: []any{assetID, 0, "CAD", "test", "MANUAL"}},
		{name: "market price currency", query: marketPriceInsert, args: []any{assetID, 1, "cad", "test", "MANUAL"}},
		{name: "market price provider", query: marketPriceInsert, args: []any{assetID, 1, "CAD", "Provider", "MANUAL"}},
		{name: "market price quality", query: marketPriceInsert, args: []any{assetID, 1, "CAD", "test", "OTHER"}},
		{name: "FX from currency", query: fxRateInsert, args: []any{workspaceID, "usd", "CAD", 1.3, "test", "MANUAL"}},
		{name: "FX to currency", query: fxRateInsert, args: []any{workspaceID, "USD", "cad", 1.3, "test", "MANUAL"}},
		{name: "FX distinct currency", query: fxRateInsert, args: []any{workspaceID, "CAD", "CAD", 1.3, "test", "MANUAL"}},
		{name: "FX positivity", query: fxRateInsert, args: []any{workspaceID, "USD", "CAD", 0, "test", "MANUAL"}},
		{name: "FX provider", query: fxRateInsert, args: []any{workspaceID, "USD", "CAD", 1.3, "Provider", "MANUAL"}},
		{name: "FX quality", query: fxRateInsert, args: []any{workspaceID, "USD", "CAD", 1.3, "test", "OTHER"}},
	}
	assertConstraintFailures(t, ctx, pool, tests)
}

func assertConstraintFailures(t *testing.T, ctx context.Context, pool *pgxpool.Pool, tests []struct {
	name  string
	query string
	args  []any
}) {
	t.Helper()
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := pool.Exec(ctx, test.query, test.args...); err == nil {
				t.Fatal("insert error = nil, want constraint violation")
			}
		})
	}
}

func canonicalTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("FINSIGHT_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("FINSIGHT_TEST_DATABASE_URL is required for canonical constraint tests")
	}
	ctx := context.Background()
	if err := RunMigrations(ctx, databaseURL, migrations.Files); err != nil {
		t.Fatalf("RunMigrations() error = %v", err)
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("pgxpool.New() error = %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func insertCanonicalTestGraph(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) {
	t.Helper()
	var userID uuid.UUID
	if err := pool.QueryRow(ctx, `insert into users (email, display_name) values ($1, 'Constraint User') returning id`, "constraint-"+uuid.NewString()+"@example.com").Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	var workspaceID uuid.UUID
	if err := pool.QueryRow(ctx, `insert into workspaces (name, base_currency, auth_mode) values ($1, 'CAD', $2) returning id`, "Constraint Workspace "+uuid.NewString(), "test-"+uuid.NewString()).Scan(&workspaceID); err != nil {
		t.Fatalf("insert workspace: %v", err)
	}
	var portfolioID uuid.UUID
	if err := pool.QueryRow(ctx, `insert into portfolios (workspace_id, name, base_currency) values ($1, $2, 'CAD') returning id`, workspaceID, "Constraint Portfolio "+uuid.NewString()).Scan(&portfolioID); err != nil {
		t.Fatalf("insert portfolio: %v", err)
	}
	var accountID uuid.UUID
	if err := pool.QueryRow(ctx, `insert into accounts (portfolio_id, name, type, base_currency) values ($1, $2, 'BROKERAGE', 'CAD') returning id`, portfolioID, "Constraint Account "+uuid.NewString()).Scan(&accountID); err != nil {
		t.Fatalf("insert account: %v", err)
	}
	var assetID uuid.UUID
	if err := pool.QueryRow(ctx, `insert into assets (workspace_id, name, asset_type, currency, symbol, provider_id, provider_symbol) values ($1, $2, 'EQUITY', 'CAD', 'TST', 'test', $3) returning id`, workspaceID, "Constraint Asset "+uuid.NewString(), uuid.NewString()).Scan(&assetID); err != nil {
		t.Fatalf("insert asset: %v", err)
	}
	return workspaceID, portfolioID, accountID, assetID, userID
}

func cleanupCanonicalTestGraph(t *testing.T, ctx context.Context, pool *pgxpool.Pool, workspaceID uuid.UUID, userID uuid.UUID) {
	t.Helper()
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `delete from transactions where portfolio_id in (select id from portfolios where workspace_id = $1)`, workspaceID); err != nil {
			t.Fatalf("delete transactions: %v", err)
		}
		if _, err := pool.Exec(ctx, `delete from workspaces where id = $1`, workspaceID); err != nil {
			t.Fatalf("delete workspace: %v", err)
		}
		if _, err := pool.Exec(ctx, `delete from users where id = $1`, userID); err != nil {
			t.Fatalf("delete user: %v", err)
		}
	})
}
