package asset

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
)

type LocalBootstrapper interface {
	BootstrapLocal(context.Context) (bootstrap.Result, error)
}

type Repository interface {
	Upsert(context.Context, uuid.UUID, UpsertInput) (Asset, error)
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

	prepared, err := PrepareUpsertInput(input)
	if err != nil {
		return Asset{}, err
	}

	localContext, err := r.bootstrap.BootstrapLocal(ctx)
	if err != nil {
		return Asset{}, fmt.Errorf("resolve local asset context: %w", err)
	}

	created, err := r.repository.Upsert(ctx, localContext.Workspace.ID, prepared)
	if err != nil {
		return Asset{}, fmt.Errorf("upsert asset: %w", err)
	}
	return created, nil
}
