package asset

import (
	"context"
	"fmt"

	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
)

type LocalBootstrapper interface {
	BootstrapLocal(context.Context) (bootstrap.Result, error)
}

type Repository interface {
	Upsert(context.Context, upsertRepositoryInput) (Asset, error)
	UpsertCash(context.Context, upsertRepositoryInput) (Asset, error)
}

type Registry struct {
	bootstrap  LocalBootstrapper
	repository Repository
}

func NewRegistry(bootstrap LocalBootstrapper, repository Repository) Registry {
	return Registry{bootstrap: bootstrap, repository: repository}
}

func (r Registry) UpsertAsset(ctx context.Context, input UpsertInput) (Asset, error) {
	if r.bootstrap == nil {
		return Asset{}, fmt.Errorf("asset bootstrapper is required")
	}
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

	localContext, err := r.bootstrap.BootstrapLocal(ctx)
	if err != nil {
		return Asset{}, fmt.Errorf("resolve local asset context: %w", err)
	}

	repositoryInput := upsertRepositoryInput{
		WorkspaceID:    localContext.Workspace.ID,
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

	var created Asset
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
