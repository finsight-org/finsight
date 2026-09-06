package bootstrap

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/finsight-org/finsight/apps/api/internal/postgres"
	"github.com/finsight-org/finsight/apps/api/migrations"
)

func TestBootstrapLocalIsIdempotent(t *testing.T) {
	pool := bootstrapTestPool(t)
	ctx := context.Background()
	runner := New(pool)

	if err := runner.BootstrapLocal(ctx); err != nil {
		t.Fatalf("first BootstrapLocal() error = %v", err)
	}
	if err := runner.BootstrapLocal(ctx); err != nil {
		t.Fatalf("second BootstrapLocal() error = %v", err)
	}

	tests := []struct {
		name  string
		query string
		args  []any
	}{
		{name: "user", query: `select count(*) from users where email = $1`, args: []any{localUserEmail}},
		{name: "workspace", query: `select count(*) from workspaces where auth_mode = $1`, args: []any{localWorkspaceAuthMode}},
		{name: "membership", query: `select count(*) from workspace_memberships wm join workspaces w on w.id = wm.workspace_id where w.auth_mode = $1`, args: []any{localWorkspaceAuthMode}},
		{name: "default portfolio", query: `select count(*) from portfolios p join workspaces w on w.id = p.workspace_id where w.auth_mode = $1 and p.is_default`, args: []any{localWorkspaceAuthMode}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var count int
			if err := pool.QueryRow(ctx, test.query, test.args...).Scan(&count); err != nil {
				t.Fatalf("count %s: %v", test.name, err)
			}
			if count != 1 {
				t.Fatalf("%s count = %d, want 1", test.name, count)
			}
		})
	}
}

func bootstrapTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("FINSIGHT_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("FINSIGHT_TEST_DATABASE_URL is required for bootstrap integration tests")
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
