package asset

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/finsight-org/finsight/apps/api/internal/postgres"
	database "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
	"github.com/finsight-org/finsight/apps/api/internal/postgres/pgconv"
)

const (
	assetNameConstraint           = "assets_name_check"
	assetTypeConstraint           = "assets_asset_type_check"
	assetCurrencyConstraint       = "assets_currency_check"
	assetSymbolConstraint         = "assets_symbol_check"
	assetProviderIDConstraint     = "assets_provider_id_check"
	assetProviderSymbolConstraint = "assets_provider_symbol_check"
)

type Store struct {
	queries *database.Queries
}

func NewStore(queries *database.Queries) *Store {
	return &Store{queries: queries}
}

func (s *Store) Upsert(ctx context.Context, workspaceID uuid.UUID, input UpsertInput) (database.Asset, error) {
	if s == nil || s.queries == nil {
		return database.Asset{}, fmt.Errorf("database queries are required")
	}

	input = normalizeUpsertInput(input)
	if input.Name == "" {
		return database.Asset{}, ErrInvalidName
	}
	if !validType(input.Type) {
		return database.Asset{}, ErrInvalidType
	}
	if !currencyPattern.MatchString(input.Currency) {
		return database.Asset{}, ErrInvalidCurrency
	}
	if input.Symbol == "" {
		return database.Asset{}, ErrInvalidSymbol
	}
	if input.ProviderID == "" || input.ProviderSymbol == "" {
		return database.Asset{}, ErrInvalidProvider
	}

	var (
		created database.Asset
		err     error
	)
	if input.Type == TypeCash {
		created, err = s.queries.UpsertCashAsset(ctx, database.UpsertCashAssetParams{
			WorkspaceID:    pgconv.UUID(workspaceID),
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
	} else {
		created, err = s.queries.UpsertAsset(ctx, database.UpsertAssetParams{
			WorkspaceID:    pgconv.UUID(workspaceID),
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
	}
	if err != nil {
		return database.Asset{}, translateUpsertError(err)
	}
	return created, nil
}

func translateUpsertError(err error) error {
	switch {
	case postgres.IsConstraintViolation(err, assetNameConstraint):
		return ErrInvalidName
	case postgres.IsConstraintViolation(err, assetTypeConstraint):
		return ErrInvalidType
	case postgres.IsConstraintViolation(err, assetCurrencyConstraint):
		return ErrInvalidCurrency
	case postgres.IsConstraintViolation(err, assetSymbolConstraint):
		return ErrInvalidSymbol
	case postgres.IsConstraintViolation(err, assetProviderIDConstraint, assetProviderSymbolConstraint):
		return ErrInvalidProvider
	default:
		return fmt.Errorf("upsert asset: %w", err)
	}
}
