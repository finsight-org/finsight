package asset

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

func (r PostgresRepository) Upsert(ctx context.Context, input upsertRepositoryInput) (Asset, error) {
	if r.db == nil {
		return Asset{}, fmt.Errorf("postgres pool is required")
	}

	row, err := db.New(r.db).UpsertAsset(ctx, db.UpsertAssetParams{
		WorkspaceID:    pgconv.UUID(input.WorkspaceID),
		Name:           input.Name,
		AssetType:      string(input.Type),
		Currency:       input.Currency,
		Symbol:         input.Symbol,
		ProviderID:     input.ProviderID,
		ProviderSymbol: input.ProviderSymbol,
		Exchange:       pgconv.Text(input.Exchange),
		Isin:           pgconv.Text(input.ISIN),
		Country:        pgconv.Text(input.Country),
		Sector:         pgconv.Text(input.Sector),
	})
	if err != nil {
		return Asset{}, fmt.Errorf("upsert asset row: %w", err)
	}
	return mapAsset(row)
}

func (r PostgresRepository) UpsertCash(ctx context.Context, input upsertRepositoryInput) (Asset, error) {
	if r.db == nil {
		return Asset{}, fmt.Errorf("postgres pool is required")
	}

	row, err := db.New(r.db).UpsertCashAsset(ctx, db.UpsertCashAssetParams{
		WorkspaceID:    pgconv.UUID(input.WorkspaceID),
		Name:           input.Name,
		Currency:       input.Currency,
		Symbol:         input.Symbol,
		ProviderID:     input.ProviderID,
		ProviderSymbol: input.ProviderSymbol,
		Exchange:       pgconv.Text(input.Exchange),
		Isin:           pgconv.Text(input.ISIN),
		Country:        pgconv.Text(input.Country),
		Sector:         pgconv.Text(input.Sector),
	})
	if err != nil {
		return Asset{}, fmt.Errorf("upsert cash asset row: %w", err)
	}
	return mapAsset(row)
}

func (r PostgresRepository) GetByWorkspaceAndID(ctx context.Context, workspaceID uuid.UUID, id uuid.UUID) (Asset, error) {
	if r.db == nil {
		return Asset{}, fmt.Errorf("postgres pool is required")
	}

	row, err := db.New(r.db).GetAssetByWorkspaceAndID(ctx, db.GetAssetByWorkspaceAndIDParams{
		WorkspaceID: pgconv.UUID(workspaceID),
		ID:          pgconv.UUID(id),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Asset{}, ErrNotFound
		}
		return Asset{}, fmt.Errorf("select asset: %w", err)
	}
	return mapAsset(row)
}

func mapAsset(row db.Asset) (Asset, error) {
	id, err := pgconv.DomainUUID(row.ID)
	if err != nil {
		return Asset{}, fmt.Errorf("id: %w", err)
	}
	workspaceID, err := pgconv.DomainUUID(row.WorkspaceID)
	if err != nil {
		return Asset{}, fmt.Errorf("workspace id: %w", err)
	}
	createdAt, err := pgconv.Time(row.CreatedAt)
	if err != nil {
		return Asset{}, fmt.Errorf("created at: %w", err)
	}
	updatedAt, err := pgconv.Time(row.UpdatedAt)
	if err != nil {
		return Asset{}, fmt.Errorf("updated at: %w", err)
	}
	return Asset{
		ID:             id,
		WorkspaceID:    workspaceID,
		Name:           row.Name,
		Type:           Type(row.AssetType),
		Currency:       row.Currency,
		Symbol:         row.Symbol,
		ProviderID:     row.ProviderID,
		ProviderSymbol: row.ProviderSymbol,
		Exchange:       pgconv.StringPointer(row.Exchange),
		ISIN:           pgconv.StringPointer(row.Isin),
		Country:        pgconv.StringPointer(row.Country),
		Sector:         pgconv.StringPointer(row.Sector),
		IsActive:       row.IsActive,
		CreatedAt:      createdAt,
		UpdatedAt:      updatedAt,
	}, nil
}
