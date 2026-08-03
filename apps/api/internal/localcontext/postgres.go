package localcontext

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	db "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
	"github.com/finsight-org/finsight/apps/api/internal/postgres/pgconv"
)

type PostgresRepository struct {
	db *pgxpool.Pool
}

func NewPostgresRepository(db *pgxpool.Pool) PostgresRepository {
	return PostgresRepository{db: db}
}

func (r PostgresRepository) DefaultScope(ctx context.Context) (Scope, error) {
	if r.db == nil {
		return Scope{}, fmt.Errorf("postgres pool is required")
	}

	row, err := db.New(r.db).GetLocalDefaultScope(ctx)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Scope{}, ErrNotFound
		}
		return Scope{}, fmt.Errorf("select local default scope: %w", err)
	}

	workspaceID, err := pgconv.DomainUUID(row.WorkspaceID)
	if err != nil {
		return Scope{}, fmt.Errorf("map local default workspace id: %w", err)
	}
	portfolioID, err := pgconv.DomainUUID(row.PortfolioID)
	if err != nil {
		return Scope{}, fmt.Errorf("map local default portfolio id: %w", err)
	}
	return Scope{WorkspaceID: workspaceID, PortfolioID: portfolioID}, nil
}
