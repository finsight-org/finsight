package localcontext

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/postgres"
	database "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
	"github.com/finsight-org/finsight/apps/api/migrations"
)

func TestResolverReturnsAndEnforcesDefaultScope(t *testing.T) {
	pool := localContextTestPool(t)
	ctx := context.Background()
	if err := bootstrap.New(pool).BootstrapLocal(ctx); err != nil {
		t.Fatalf("BootstrapLocal() error = %v", err)
	}
	resolver := New(database.New(pool))

	scope, err := resolver.DefaultScope(ctx)
	if err != nil {
		t.Fatalf("DefaultScope() error = %v", err)
	}
	if scope.WorkspaceID == uuid.Nil || scope.PortfolioID == uuid.Nil {
		t.Fatalf("DefaultScope() = %#v, want nonzero IDs", scope)
	}
	portfolioID, err := resolver.DefaultPortfolioID(ctx)
	if err != nil {
		t.Fatalf("DefaultPortfolioID() error = %v", err)
	}
	if portfolioID != scope.PortfolioID {
		t.Fatalf("DefaultPortfolioID() = %s, want %s", portfolioID, scope.PortfolioID)
	}
	if err := resolver.EnsurePortfolio(ctx, portfolioID); err != nil {
		t.Fatalf("EnsurePortfolio(default) error = %v", err)
	}
	if err := resolver.EnsurePortfolio(ctx, uuid.New()); !errors.Is(err, ErrPortfolioNotAllowed) {
		t.Fatalf("EnsurePortfolio(other) error = %v, want %v", err, ErrPortfolioNotAllowed)
	}
}

func localContextTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("FINSIGHT_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("FINSIGHT_TEST_DATABASE_URL is required for local-context integration tests")
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
