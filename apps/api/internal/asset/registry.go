package asset

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

type Repository interface {
	Upsert(context.Context, upsertRepositoryInput) (Asset, error)
	UpsertCash(context.Context, upsertRepositoryInput) (Asset, error)
}

type Registry struct {
	repository Repository
}

func NewRegistry(repository Repository) Registry {
	return Registry{repository: repository}
}

func (r Registry) UpsertAsset(ctx context.Context, workspaceID uuid.UUID, input UpsertInput) (Asset, error) {
	if r.repository == nil {
		return Asset{}, fmt.Errorf("asset repository is required")
	}

	input = normalizeUpsertInput(input)
	if input.Name == "" {
		return Asset{}, ErrInvalidName
	}
	if !validType(input.Type) {
		return Asset{}, ErrInvalidType
	}
	if !currencyPattern.MatchString(input.Currency) {
		return Asset{}, ErrInvalidCurrency
	}
	if input.Symbol == "" {
		return Asset{}, ErrInvalidSymbol
	}
	if input.ProviderID == "" || input.ProviderSymbol == "" {
		return Asset{}, ErrInvalidProvider
	}

	repositoryInput := upsertRepositoryInput{
		WorkspaceID:    workspaceID,
		Name:           input.Name,
		Type:           input.Type,
		Currency:       input.Currency,
		Symbol:         input.Symbol,
		ProviderID:     input.ProviderID,
		ProviderSymbol: input.ProviderSymbol,
		Exchange:       input.Exchange,
		ISIN:           input.ISIN,
		Country:        input.Country,
		Sector:         input.Sector,
	}

	var (
		created Asset
		err     error
	)
	if input.Type == TypeCash {
		created, err = r.repository.UpsertCash(ctx, repositoryInput)
	} else {
		created, err = r.repository.Upsert(ctx, repositoryInput)
	}
	if err != nil {
		return Asset{}, fmt.Errorf("upsert asset: %w", err)
	}
	return created, nil
}
