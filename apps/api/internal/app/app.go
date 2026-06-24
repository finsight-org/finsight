package app

import (
	"context"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/config"
	"github.com/finsight-org/finsight/apps/api/internal/httpapi"
	"github.com/finsight-org/finsight/apps/api/internal/postgres"
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

	if err := postgres.RunMigrations(ctx, cfg.DatabaseURL, migrations.Files); err != nil {
		db.Close()
		return nil, fmt.Errorf("run postgres migrations: %w", err)
	}

	bootstrapRepository := bootstrap.NewPostgresRepository(db)
	bootstrapService := bootstrap.NewService(bootstrapRepository)

	handler := httpapi.NewRouter(httpapi.Options{
		ServiceName:  cfg.ServiceName,
		Version:      cfg.Version,
		ReadyTimeout: cfg.ReadyTimeout,
		Database:     db,
		Bootstrap:    bootstrapService,
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
