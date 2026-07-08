package demo

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/finsight-org/finsight/apps/api/internal/account"
	db "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
	"github.com/finsight-org/finsight/apps/api/internal/postgres/pgconv"
)

type PostgresRepository struct {
	db *pgxpool.Pool
}

func NewPostgresRepository(db *pgxpool.Pool) PostgresRepository {
	return PostgresRepository{db: db}
}

func (r PostgresRepository) DeleteDemoData(ctx context.Context, workspaceID uuid.UUID, portfolioID uuid.UUID) error {
	if r.db == nil {
		return fmt.Errorf("postgres pool is required")
	}
	queries := db.New(r.db)
	if err := queries.DeleteDemoTransactions(ctx, pgconv.UUID(portfolioID)); err != nil {
		return fmt.Errorf("delete demo transactions: %w", err)
	}
	if err := queries.DeleteDemoMarketPrices(ctx, pgconv.UUID(workspaceID)); err != nil {
		return fmt.Errorf("delete demo market prices: %w", err)
	}
	return nil
}

func (r PostgresRepository) UpsertDemoAccount(ctx context.Context, input upsertAccountInput) (account.Account, error) {
	if r.db == nil {
		return account.Account{}, fmt.Errorf("postgres pool is required")
	}
	row, err := db.New(r.db).UpsertDemoAccount(ctx, db.UpsertDemoAccountParams{
		PortfolioID:       pgconv.UUID(input.PortfolioID),
		Name:              input.Name,
		InstitutionName:   pgconv.Text(&input.InstitutionName),
		Type:              string(input.Type),
		BaseCurrency:      input.BaseCurrency,
		ExternalReference: pgconv.Text(&input.ExternalReference),
	})
	if err != nil {
		return account.Account{}, fmt.Errorf("upsert demo account: %w", err)
	}
	return mapAccount(row)
}

func (r PostgresRepository) UpsertMarketPrice(ctx context.Context, input upsertMarketPriceInput) error {
	if r.db == nil {
		return fmt.Errorf("postgres pool is required")
	}
	_, err := db.New(r.db).UpsertMarketPrice(ctx, db.UpsertMarketPriceParams{
		AssetID:       pgconv.UUID(input.AssetID),
		Date:          pgconv.Date(input.Date),
		Price:         pgconv.Numeric(input.Price),
		Currency:      "CAD",
		ProviderID:    "demo",
		SourceQuality: "DEMO",
	})
	if err != nil {
		return fmt.Errorf("upsert market price: %w", err)
	}
	return nil
}

func mapAccount(row db.Account) (account.Account, error) {
	id, err := pgconv.DomainUUID(row.ID)
	if err != nil {
		return account.Account{}, fmt.Errorf("id: %w", err)
	}
	portfolioID, err := pgconv.DomainUUID(row.PortfolioID)
	if err != nil {
		return account.Account{}, fmt.Errorf("portfolio id: %w", err)
	}
	createdAt, err := pgconv.Time(row.CreatedAt)
	if err != nil {
		return account.Account{}, fmt.Errorf("created at: %w", err)
	}
	updatedAt, err := pgconv.Time(row.UpdatedAt)
	if err != nil {
		return account.Account{}, fmt.Errorf("updated at: %w", err)
	}
	return account.Account{
		ID:                id,
		PortfolioID:       portfolioID,
		Name:              row.Name,
		InstitutionName:   pgconv.StringPointer(row.InstitutionName),
		Type:              account.Type(row.Type),
		BaseCurrency:      row.BaseCurrency,
		ExternalReference: pgconv.StringPointer(row.ExternalReference),
		CreatedAt:         createdAt,
		UpdatedAt:         updatedAt,
	}, nil
}
