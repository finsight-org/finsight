package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"

	"github.com/pressly/goose/v3"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type MigrationRunner struct {
	databaseURL string
	migrationFS fs.FS
}

func NewMigrationRunner(databaseURL string, migrationFS fs.FS) MigrationRunner {
	return MigrationRunner{databaseURL: databaseURL, migrationFS: migrationFS}
}

func (m MigrationRunner) Migrate(ctx context.Context) error {
	return RunMigrations(ctx, m.databaseURL, m.migrationFS)
}

func RunMigrations(ctx context.Context, databaseURL string, migrationFS fs.FS) error {
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return fmt.Errorf("open migration database: %w", err)
	}
	defer func() {
		_ = db.Close()
	}()

	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("ping migration database: %w", err)
	}

	goose.SetBaseFS(migrationFS)
	defer goose.SetBaseFS(nil)

	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("set migration dialect: %w", err)
	}
	if err := goose.UpContext(ctx, db, "."); err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}

	return nil
}
