package localcontext

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	database "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
	"github.com/finsight-org/finsight/apps/api/internal/postgres/pgconv"
)

type Scope struct {
	WorkspaceID uuid.UUID
	PortfolioID uuid.UUID
}

type Resolver struct {
	queries *database.Queries
}

func New(queries *database.Queries) *Resolver {
	return &Resolver{queries: queries}
}

func (r *Resolver) DefaultScope(ctx context.Context) (Scope, error) {
	if r == nil || r.queries == nil {
		return Scope{}, fmt.Errorf("database queries are required")
	}

	row, err := r.queries.GetLocalDefaultScope(ctx)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Scope{}, ErrNotFound
		}
		return Scope{}, fmt.Errorf("get local default scope: %w", err)
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

func (r *Resolver) DefaultPortfolioID(ctx context.Context) (uuid.UUID, error) {
	scope, err := r.DefaultScope(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	return scope.PortfolioID, nil
}

func (r *Resolver) EnsurePortfolio(ctx context.Context, portfolioID uuid.UUID) error {
	defaultPortfolioID, err := r.DefaultPortfolioID(ctx)
	if err != nil {
		return err
	}
	if portfolioID != defaultPortfolioID {
		return ErrPortfolioNotAllowed
	}
	return nil
}
