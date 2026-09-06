package main

import (
	"context"
	"fmt"
	"os"

	"github.com/finsight-org/finsight/apps/api/internal/asset"
	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/config"
	"github.com/finsight-org/finsight/apps/api/internal/demo"
	"github.com/finsight-org/finsight/apps/api/internal/localcontext"
	"github.com/finsight-org/finsight/apps/api/internal/postgres"
	database "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
	"github.com/finsight-org/finsight/apps/api/internal/startup"
	"github.com/finsight-org/finsight/apps/api/internal/transaction"
	"github.com/finsight-org/finsight/apps/api/migrations"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "seed demo data: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("Seeded demo portfolio data.")
}

func run() error {
	ctx := context.Background()
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	if cfg.DeploymentMode != config.DeploymentModeLocal {
		return fmt.Errorf("demo seeding requires local deployment mode")
	}

	db, err := postgres.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("create postgres pool: %w", err)
	}
	defer db.Close()

	queries := database.New(db)
	bootstrapRunner := bootstrap.New(db)
	initializer := startup.New(
		postgres.NewMigrationRunner(cfg.DatabaseURL, migrations.Files),
		bootstrapRunner,
		cfg.DeploymentMode,
	)
	if err := initializer.Initialize(ctx); err != nil {
		return fmt.Errorf("initialize demo startup: %w", err)
	}
	localContext := localcontext.New(queries)
	scope, err := localContext.DefaultScope(ctx)
	if err != nil {
		return fmt.Errorf("get local demo scope: %w", err)
	}

	assetStore := asset.NewStore(queries)
	transactionRecorder := transaction.New(db)
	seeder := demo.NewSeeder(assetStore, transactionRecorder, queries)

	return seeder.Seed(ctx, scope.WorkspaceID, scope.PortfolioID)
}
