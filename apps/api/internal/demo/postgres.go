package demo

import (
	"context"
	"fmt"

	"github.com/google/uuid"
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
	if err := queries.DeleteDemoFxRates(ctx, pgconv.UUID(workspaceID)); err != nil {
		return fmt.Errorf("delete demo fx rates: %w", err)
	}
	return nil
}

func (r PostgresRepository) UpsertDemoAccount(ctx context.Context, input upsertAccountInput) (uuid.UUID, error) {
	if r.db == nil {
		return uuid.Nil, fmt.Errorf("postgres pool is required")
	}
	row, err := db.New(r.db).UpsertDemoAccount(ctx, db.UpsertDemoAccountParams{
		PortfolioID:       pgconv.UUID(input.PortfolioID),
		Name:              input.Name,
		InstitutionName:   pgconv.Text(&input.InstitutionName),
		Type:              input.Type,
		BaseCurrency:      input.BaseCurrency,
		ExternalReference: pgconv.Text(&input.ExternalReference),
	})
	if err != nil {
		return uuid.Nil, fmt.Errorf("upsert demo account: %w", err)
	}
	id, err := pgconv.DomainUUID(row.ID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("map demo account id: %w", err)
	}
	return id, nil
}

func (r PostgresRepository) UpsertMarketPrice(ctx context.Context, input upsertMarketPriceInput) error {
	if r.db == nil {
		return fmt.Errorf("postgres pool is required")
	}
	_, err := db.New(r.db).UpsertMarketPrice(ctx, db.UpsertMarketPriceParams{
		AssetID:       pgconv.UUID(input.AssetID),
		Date:          pgconv.Date(input.Date),
		Price:         pgconv.Numeric(input.Price),
		Currency:      input.Currency,
		ProviderID:    "demo",
		SourceQuality: "DEMO",
	})
	if err != nil {
		return fmt.Errorf("upsert market price: %w", err)
	}
	return nil
}

func (r PostgresRepository) UpsertFXRate(ctx context.Context, input upsertFXRateInput) error {
	if r.db == nil {
		return fmt.Errorf("postgres pool is required")
	}
	_, err := db.New(r.db).UpsertDemoFxRate(ctx, db.UpsertDemoFxRateParams{
		WorkspaceID:   pgconv.UUID(input.WorkspaceID),
		FromCurrency:  input.FromCurrency,
		ToCurrency:    input.ToCurrency,
		Date:          pgconv.Date(input.Date),
		Rate:          pgconv.Numeric(input.Rate),
		ProviderID:    "demo",
		SourceQuality: "DEMO",
	})
	if err != nil {
		return fmt.Errorf("upsert fx rate: %w", err)
	}
	return nil
}
