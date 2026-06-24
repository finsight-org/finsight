package app

import (
	"context"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/finsight-org/finsight/apps/api/internal/config"
	"github.com/finsight-org/finsight/apps/api/internal/httpapi"
	"github.com/finsight-org/finsight/apps/api/internal/postgres"
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

	handler := httpapi.NewRouter(httpapi.Options{
		ServiceName:  cfg.ServiceName,
		Version:      cfg.Version,
		ReadyTimeout: cfg.ReadyTimeout,
		Database:     db,
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
