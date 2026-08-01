package main

import (
	"context"
	"fmt"
	"os"

	"github.com/finsight-org/finsight/apps/api/internal/asset"
	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/config"
	"github.com/finsight-org/finsight/apps/api/internal/demo"
	"github.com/finsight-org/finsight/apps/api/internal/postgres"
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

	bootstrapRepository := bootstrap.NewPostgresRepository(db)
	bootstrapService := bootstrap.NewService(bootstrapRepository)
	initializer := startup.New(
		postgres.NewMigrationRunner(cfg.DatabaseURL, migrations.Files),
		bootstrapService,
		cfg.DeploymentMode,
	)
	if err := initializer.Initialize(ctx); err != nil {
		return fmt.Errorf("initialize demo startup: %w", err)
	}

	assetRepository := asset.NewPostgresRepository(db)
	assetRegistry := asset.NewRegistry(bootstrapService, assetRepository)
	transactionRepository := transaction.NewPostgresRepository(db)
	transactionService := transaction.NewService(bootstrapService, transactionRepository)
	demoRepository := demo.NewPostgresRepository(db)
	seeder := demo.NewSeeder(bootstrapService, assetRegistry, transactionService, demoRepository)

	return seeder.Seed(ctx)
}
