package startup

import (
	"context"
	"fmt"

	"github.com/finsight-org/finsight/apps/api/internal/config"
)

type Migrator interface {
	Migrate(context.Context) error
}

type LocalBootstrapper interface {
	BootstrapLocal(context.Context) error
}

type Initializer struct {
	migrator       Migrator
	localBootstrap LocalBootstrapper
	deploymentMode config.DeploymentMode
}

func New(migrator Migrator, localBootstrap LocalBootstrapper, deploymentMode config.DeploymentMode) *Initializer {
	return &Initializer{
		migrator:       migrator,
		localBootstrap: localBootstrap,
		deploymentMode: deploymentMode,
	}
}

func (i *Initializer) Initialize(ctx context.Context) error {
	if i == nil || i.migrator == nil {
		return fmt.Errorf("startup migrator is required")
	}
	if err := i.migrator.Migrate(ctx); err != nil {
		return fmt.Errorf("run startup migrations: %w", err)
	}

	switch i.deploymentMode {
	case config.DeploymentModeManaged:
		return nil
	case config.DeploymentModeLocal:
		if i.localBootstrap == nil {
			return fmt.Errorf("local startup bootstrapper is required")
		}
		if err := i.localBootstrap.BootstrapLocal(ctx); err != nil {
			return fmt.Errorf("bootstrap local startup data: %w", err)
		}
		return nil
	default:
		return fmt.Errorf("unsupported deployment mode %q", i.deploymentMode)
	}
}
