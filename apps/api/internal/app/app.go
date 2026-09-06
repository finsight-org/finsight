package app

import (
	"context"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/finsight-org/finsight/apps/api/internal/account"
	"github.com/finsight-org/finsight/apps/api/internal/asset"
	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/config"
	"github.com/finsight-org/finsight/apps/api/internal/httpapi"
	"github.com/finsight-org/finsight/apps/api/internal/localcontext"
	"github.com/finsight-org/finsight/apps/api/internal/portfoliovalue"
	"github.com/finsight-org/finsight/apps/api/internal/postgres"
	database "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
	"github.com/finsight-org/finsight/apps/api/internal/startup"
	"github.com/finsight-org/finsight/apps/api/migrations"
)

type App struct {
	Handler http.Handler

	db *pgxpool.Pool
}

func New(ctx context.Context, cfg config.Config) (*App, error) {
	db, err := postgres.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("create postgres pool: %w", err)
	}

	queries := database.New(db)
	bootstrapRunner := bootstrap.New(db)
	localContextResolver := localcontext.New(queries)
	accountStore := account.New(queries)
	portfolioCalculator := portfoliovalue.New(queries)
	assetFinder := asset.NewFinder(asset.NewYahooProvider())

	initializer := startup.New(
		postgres.NewMigrationRunner(cfg.DatabaseURL, migrations.Files),
		bootstrapRunner,
		cfg.DeploymentMode,
	)
	if err := initializer.Initialize(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("initialize application: %w", err)
	}

	handler := httpapi.NewRouter(httpapi.Options{
		ServiceName:    cfg.ServiceName,
		Version:        cfg.Version,
		ReadyTimeout:   cfg.ReadyTimeout,
		Database:       db,
		DeploymentMode: cfg.DeploymentMode,
		LocalContext:   localContextResolver,
		Accounts:       accountStore,
		Assets:         assetFinder,
		Portfolio:      portfolioCalculator,
	})

	return &App{
		Handler: handler,
		db:      db,
	}, nil
}

func (a *App) Close() {
	if a.db != nil {
		a.db.Close()
	}
}
