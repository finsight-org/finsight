package localcontext

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
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

func (r PostgresRepository) DefaultPortfolioID(ctx context.Context) (uuid.UUID, error) {
	if r.db == nil {
		return uuid.Nil, fmt.Errorf("postgres pool is required")
	}

	id, err := db.New(r.db).GetLocalDefaultPortfolioID(ctx)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, ErrNotFound
		}
		return uuid.Nil, fmt.Errorf("select local default portfolio: %w", err)
	}

	portfolioID, err := pgconv.DomainUUID(id)
	if err != nil {
		return uuid.Nil, fmt.Errorf("map local default portfolio id: %w", err)
	}
	return portfolioID, nil
}
