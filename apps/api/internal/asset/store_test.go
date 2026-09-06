package asset

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/finsight-org/finsight/apps/api/internal/postgres"
	database "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
	"github.com/finsight-org/finsight/apps/api/migrations"
)

func TestTranslateUpsertError(t *testing.T) {
	tests := []struct {
		constraint string
		want       error
	}{
		{constraint: assetNameConstraint, want: ErrInvalidName},
		{constraint: assetTypeConstraint, want: ErrInvalidType},
		{constraint: assetCurrencyConstraint, want: ErrInvalidCurrency},
		{constraint: assetSymbolConstraint, want: ErrInvalidSymbol},
		{constraint: assetProviderIDConstraint, want: ErrInvalidProvider},
		{constraint: assetProviderSymbolConstraint, want: ErrInvalidProvider},
	}
	for _, test := range tests {
		t.Run(test.constraint, func(t *testing.T) {
			databaseErr := fmt.Errorf("wrapped: %w", &pgconn.PgError{Code: "23514", ConstraintName: test.constraint})
			if err := translateUpsertError(databaseErr); !errors.Is(err, test.want) {
				t.Fatalf("translateUpsertError() error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestNormalizeUpsertInput(t *testing.T) {
	exchange := "  TSX  "
	blank := "   "
	input := normalizeUpsertInput(UpsertInput{
		Name:           "  iShares Core Equity ETF  ",
		Currency:       " CAD ",
		Symbol:         " XEQT ",
		ProviderID:     " Yahoo ",
		ProviderSymbol: " XEQT.TO ",
		Exchange:       &exchange,
		Sector:         &blank,
	})
	if input.Name != "iShares Core Equity ETF" || input.Currency != "CAD" || input.Symbol != "XEQT" {
		t.Fatalf("normalized asset text = %#v", input)
	}
	if input.ProviderID != "yahoo" || input.ProviderSymbol != "xeqt.to" {
		t.Fatalf("normalized provider identity = %q/%q", input.ProviderID, input.ProviderSymbol)
	}
	if input.Exchange == nil || *input.Exchange != "TSX" || input.Sector != nil {
		t.Fatalf("normalized optional metadata = %#v/%#v", input.Exchange, input.Sector)
	}
}

func TestStoreUpsertsCanonicalAssetsWithinWorkspace(t *testing.T) {
	pool := assetTestPool(t)
	ctx := context.Background()
	workspaceID := insertAssetTestWorkspace(t, ctx, pool)
	t.Cleanup(func() { deleteAssetTestWorkspace(t, ctx, pool, workspaceID) })
	store := NewStore(database.New(pool))
	exchange := "  TSX  "

	created, err := store.Upsert(ctx, workspaceID, UpsertInput{
		Name:           "  iShares Core Equity ETF  ",
		Type:           TypeETF,
		Currency:       "CAD",
		Symbol:         " XEQT ",
		ProviderID:     " Demo ",
		ProviderSymbol: " XEQT.TO ",
		Exchange:       &exchange,
	})
	if err != nil {
		t.Fatalf("Upsert() error = %v", err)
	}
	if created.Name != "iShares Core Equity ETF" || created.Symbol != "XEQT" || created.ProviderID != "demo" || created.ProviderSymbol != "xeqt.to" {
		t.Fatalf("created asset = %#v", created)
	}
	if !created.Exchange.Valid || created.Exchange.String != "TSX" {
		t.Fatalf("exchange = %#v, want TSX", created.Exchange)
	}

	updated, err := store.Upsert(ctx, workspaceID, UpsertInput{
		Name:           "XEQT Updated",
		Type:           TypeETF,
		Currency:       "CAD",
		Symbol:         "XEQT",
		ProviderID:     "demo",
		ProviderSymbol: "xeqt.to",
	})
	if err != nil {
		t.Fatalf("second Upsert() error = %v", err)
	}
	if updated.ID != created.ID || updated.Name != "XEQT Updated" {
		t.Fatalf("updated asset = %#v, want same ID and updated name", updated)
	}
}

func TestStoreScopesProviderIdentityByWorkspace(t *testing.T) {
	pool := assetTestPool(t)
	ctx := context.Background()
	firstWorkspaceID := insertAssetTestWorkspace(t, ctx, pool)
	secondWorkspaceID := insertAssetTestWorkspace(t, ctx, pool)
	t.Cleanup(func() { deleteAssetTestWorkspace(t, ctx, pool, firstWorkspaceID) })
	t.Cleanup(func() { deleteAssetTestWorkspace(t, ctx, pool, secondWorkspaceID) })
	store := NewStore(database.New(pool))
	input := UpsertInput{Name: "Bitcoin", Type: TypeCrypto, Currency: "USD", Symbol: "BTC", ProviderID: "demo", ProviderSymbol: "btc-usd"}

	first, err := store.Upsert(ctx, firstWorkspaceID, input)
	if err != nil {
		t.Fatalf("first Upsert() error = %v", err)
	}
	second, err := store.Upsert(ctx, secondWorkspaceID, input)
	if err != nil {
		t.Fatalf("second Upsert() error = %v", err)
	}
	if first.ID == second.ID {
		t.Fatalf("asset IDs are equal across workspaces: %v", first.ID)
	}
}

func TestStoreUpsertsOneCashAssetPerCurrency(t *testing.T) {
	pool := assetTestPool(t)
	ctx := context.Background()
	workspaceID := insertAssetTestWorkspace(t, ctx, pool)
	t.Cleanup(func() { deleteAssetTestWorkspace(t, ctx, pool, workspaceID) })
	store := NewStore(database.New(pool))

	first, err := store.Upsert(ctx, workspaceID, UpsertInput{Name: "Canadian Dollar", Type: TypeCash, Currency: "CAD", Symbol: "CAD", ProviderID: "first", ProviderSymbol: "cash:cad"})
	if err != nil {
		t.Fatalf("first Upsert() error = %v", err)
	}
	second, err := store.Upsert(ctx, workspaceID, UpsertInput{Name: "CAD Cash", Type: TypeCash, Currency: "CAD", Symbol: "C$", ProviderID: "second", ProviderSymbol: "cad"})
	if err != nil {
		t.Fatalf("second Upsert() error = %v", err)
	}
	if first.ID != second.ID || second.Name != "CAD Cash" {
		t.Fatalf("cash assets = %#v / %#v, want one updated row", first, second)
	}
}

func assetTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("FINSIGHT_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("FINSIGHT_TEST_DATABASE_URL is required for asset integration tests")
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

func insertAssetTestWorkspace(t *testing.T, ctx context.Context, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(ctx, `insert into workspaces (name, base_currency, auth_mode) values ($1, 'CAD', $2) returning id`, "Asset Test "+uuid.NewString(), "test-"+uuid.NewString()).Scan(&id); err != nil {
		t.Fatalf("insert workspace: %v", err)
	}
	return id
}

func deleteAssetTestWorkspace(t *testing.T, ctx context.Context, pool *pgxpool.Pool, workspaceID uuid.UUID) {
	t.Helper()
	if _, err := pool.Exec(ctx, `delete from workspaces where id = $1`, workspaceID); err != nil {
		t.Fatalf("delete workspace: %v", err)
	}
}
